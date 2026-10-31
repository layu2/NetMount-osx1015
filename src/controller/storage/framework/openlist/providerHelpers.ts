import { logger } from '../../../../services/LoggerService'

export function normalizeStorageId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export interface DriverInfo {
  name?: string
  config?: {
    name?: string
  }
  common?: DriverOption[]
  additional?: DriverOption[]
}

export interface DriverOption {
  name: string
  help?: string
  type?: string
  required?: boolean
  default?: unknown
  options?: string
}

export function detectDriverListStructure(data: unknown): 'object-map' | 'array' | 'unknown' {
  if (!data) return 'unknown'

  if (Array.isArray(data)) {
    // Some OpenList builds expose /api/admin/driver/list as a plain
    // string[] of driver names rather than driver metadata. Those entries
    // cannot be normalized here; return unknown so the caller falls back
    // to /api/admin/driver/names + /api/admin/driver/info.
    if (data.every(driver => typeof driver === 'string')) {
      logger.info('Driver list contains names only; falling back to driver info endpoint', 'OpenListProviders')
      return {}
    }

    const result: Record<string, DriverInfo> = {}
    ;(data as DriverInfo[]).forEach(driver => {
      if (!driver || typeof driver !== 'object') return
      const key = driver.name || driver.config?.name
      if (key) result[key] = driver
    })
    return result
  }

    logger.error('Unknown driver list structure:', undefined, 'OpenListProviders', { data })
    return {}
}

export function safeGetDriverConfig(provider: DriverInfo, key: string): { name?: string } {
  const defaultConfig = { name: key }

  if (!provider) return defaultConfig

  if (!provider.config) {
    logger.warn(`Driver ${key} missing config field, using fallback`, 'OpenListProviders')
    return { name: key }
  }

  return {
    name: provider.config.name || key,
  }
}

export function safeGetDriverOptions(
  provider: DriverInfo,
  field: 'common' | 'additional'
): DriverOption[] {
  if (!provider) return []

  const options = provider[field]

  if (!options) {
    logger.warn(`Driver ${provider.name || 'unknown'} missing ${field} field`, 'OpenListProviders')
    return []
  }

  if (!Array.isArray(options)) {
    logger.warn(`Driver ${provider.name || 'unknown'} ${field} is not an array`, 'OpenListProviders')
    return []
  }

  return options
}
