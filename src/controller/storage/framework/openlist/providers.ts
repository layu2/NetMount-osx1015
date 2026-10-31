import { StorageInfoType, StorageParamItemType } from '../../../../type/controller/storage/info'
import { openlist_api_get } from '../../../../utils/openlist/request'
import { logger } from '../../../../services/LoggerService'
import {
  normalizeStorageId,
  normalizeDriverList,
  safeGetDriverConfig,
  safeGetDriverOptions,
  DriverOption,
} from './providerHelpers'

async function updateOpenlistStorageInfoList() {
  try {
    const response = await openlist_api_get('/api/admin/driver/list')

    if (!response.data) {
      logger.error('Failed to get driver list: no data in response', undefined, 'OpenListProviders', { response })
      return []
    }

    const openlistProviders = normalizeDriverList(response.data)
    const openlistStorageInfoList: StorageInfoType[] = []

    if (Object.keys(openlistProviders).length === 0) {
      logger.info('Driver list normalization failed, trying fallback approach...', 'OpenListProviders')
      return await updateOpenlistStorageInfoListFallback()
    }

    for (const key in openlistProviders) {
      try {
        const provider = openlistProviders[key]

        if (!provider || typeof provider !== 'object') {
          logger.warn(`Skipping invalid driver data for key: ${key}`, 'OpenListProviders')
          continue
        }

        const config = safeGetDriverConfig(provider, key)
        const commonOptions = safeGetDriverOptions(provider, 'common')
        const additionalOptions = safeGetDriverOptions(provider, 'additional')

        const getStorageParams = (
          options: DriverOption[],
          prefix: string = ''
        ): StorageParamItemType[] => {
          const storageParams: StorageParamItemType[] = []

          for (const option of options) {
            if (!option || typeof option !== 'object') {
              logger.warn(`Skipping invalid option in driver ${key}`, 'OpenListProviders')
              continue
            }

            const storageParam: StorageParamItemType = {
              label: option.name || 'unknown',
              name: prefix + (option.name || 'unknown'),
              description: option.help || '',
              type: 'string',
              required: option.required || false,
              default: '',
              advanced: false,
              isPassword: /password|passwd|token|cookie|authorization|secret|apikey|api_key/i.test(option.name || ''),
              mark: [],
            }

            let type: 'boolean' | 'number' | 'string'
            switch (option.type) {
              case 'bool':
                type = 'boolean'
                break
              case 'number':
                type = 'number'
                break
              default:
                type = 'string'
            }
            storageParam.type = type

            let defaultValue: string | number | boolean
            if (type === 'boolean') {
              const rawDefault = option.default
              if (typeof rawDefault === 'boolean') {
                defaultValue = rawDefault
              } else if (typeof rawDefault === 'string') {
                defaultValue = rawDefault.toLowerCase() === 'true'
              } else {
                defaultValue = Boolean(rawDefault)
              }
            } else if (type === 'number') {
              defaultValue = Number(option.default) || 0
            } else {
              defaultValue = option.default !== undefined ? String(option.default) : ''
            }
            storageParam.default = defaultValue

            if (option.type === 'select' && option.options) {
              try {
                storageParam.select = option.options.split(',').map((item: string) => {
                  return {
                    label: item.trim(),
                    value: item.trim(),
                    help: item.trim(),
                  }
                })
              } catch (e) {
                logger.warn(`Failed to parse select options for ${option.name}: ${e}`, 'OpenListProviders')
                storageParam.select = []
              }
            }

            if (
              [
                'mount_path',
                'order',
                'webdav_policy',
                'web_proxy',
                'remark',
                'order_by',
                'order_direction',
                'enable_sign',
                'cache_expiration',
                'down_proxy_url',
                'extract_folder',
                'disable_index',
                'disable_proxy_sign',
                'custom_cache_policies',
                'disable_disk_usage',
                'enable_direct_upload',
              ].includes(option.name)
            ) {
              storageParam.hide = true
            }

            if (option.name === 'webdav_policy') {
              storageParam.default = 'native_proxy'
            }

            if (option.name === 'cache_expiration') {
              storageParam.default = 0
            }

            if (option.name === 'disable_disk_usage') {
              storageParam.default = false
            }

            storageParams.push(storageParam)
          }
          return storageParams
        }

        openlistStorageInfoList.push({
          label: 'storage.' + normalizeStorageId(config.name ?? key),
          type: key,
          description: 'description.' + normalizeStorageId(key),
          framework: 'openlist',
          defaultParams: {
            name: config.name + '_new',
            parameters: getStorageParams(commonOptions).concat(
              getStorageParams(additionalOptions, 'addition.')
            ),
            exParameters: {
              openlist: {
                supplement: [],
              },
            },
          },
        })
      } catch (driverError) {
        logger.error(`Error processing driver ${key}:`, driverError as Error, 'OpenListProviders')
        continue
      }
    }

    logger.info(`Successfully loaded ${openlistStorageInfoList.length} OpenList drivers`, 'OpenListProviders')
    return openlistStorageInfoList
  } catch (error) {
    logger.error('Failed to update OpenList storage info list:', error as Error, 'OpenListProviders')
    return []
  }
}

async function updateOpenlistStorageInfoListFallback(): Promise<StorageInfoType[]> {
  try {
    logger.info('Using fallback: /api/admin/driver/names + /api/admin/driver/info', 'OpenListProviders')

    const namesResponse = await openlist_api_get('/api/admin/driver/names')
    if (!namesResponse.data || !Array.isArray(namesResponse.data)) {
      logger.error('Failed to get driver names:', undefined, 'OpenListProviders', { response: namesResponse })
      return []
    }

    const openlistStorageInfoList: StorageInfoType[] = []

    for (const driverName of namesResponse.data) {
      try {
        const infoResponse = await openlist_api_get('/api/admin/driver/info', {
          driver: driverName,
        })
        if (!infoResponse.data) {
          logger.warn(`Failed to get info for driver ${driverName}`, 'OpenListProviders')
          continue
        }

        const provider = infoResponse.data
        const config = safeGetDriverConfig(provider, driverName)
        const commonOptions = safeGetDriverOptions(provider, 'common')
        const additionalOptions = safeGetDriverOptions(provider, 'additional')

        const parseOptions = (
          options: DriverOption[],
          prefix: string = ''
        ): StorageParamItemType[] => {
          const result: StorageParamItemType[] = options.map(option => {
            const type: 'boolean' | 'number' | 'string' =
              option.type === 'bool' ? 'boolean' : option.type === 'number' ? 'number' : 'string'

            let defaultValue: string | number | boolean
            if (type === 'boolean') {
              const rawDefault = option.default
              if (typeof rawDefault === 'boolean') {
                defaultValue = rawDefault
              } else if (typeof rawDefault === 'string') {
                defaultValue = rawDefault.toLowerCase() === 'true'
              } else {
                defaultValue = Boolean(rawDefault)
              }
            } else if (type === 'number') {
              defaultValue = Number(option.default) || 0
            } else {
              defaultValue = option.default !== undefined ? String(option.default) : ''
            }

            return {
              label: option.name || 'unknown',
              name: prefix + (option.name || 'unknown'),
              description: option.help || '',
              type: type,
              required: option.required || false,
              default: defaultValue,
              advanced: false,
              isPassword: false,
              mark: [],
              hide: ['mount_path', 'order', 'webdav_policy', 'web_proxy', 'remark'].includes(
                option.name
              ),
              select:
                option.type === 'select' && option.options
                  ? option.options
                      .split(',')
                      .map((item: string) => ({
                        label: item.trim(),
                        value: item.trim(),
                        help: item.trim(),
                      }))
                  : [],
            }
          })

          return result
        }

        openlistStorageInfoList.push({
          label: 'storage.' + normalizeStorageId(config.name ?? driverName),
          type: driverName,
          description: 'description.' + normalizeStorageId(driverName),
          framework: 'openlist',
          defaultParams: {
            name: config.name + '_new',
            parameters: parseOptions(commonOptions).concat(
              parseOptions(additionalOptions, 'addition.')
            ),
            exParameters: {
              openlist: {
                supplement: [],
              },
            },
          },
        })
      } catch (e) {
        logger.warn(`Error fetching driver info for ${driverName}: ${e}`, 'OpenListProviders')
        continue
      }
    }

    logger.info(`Fallback: Successfully loaded ${openlistStorageInfoList.length} OpenList drivers`, 'OpenListProviders')
    return openlistStorageInfoList
  } catch (error) {
    logger.error('Fallback approach also failed:', error as Error, 'OpenListProviders')
    return []
  }
}

export { updateOpenlistStorageInfoList }
