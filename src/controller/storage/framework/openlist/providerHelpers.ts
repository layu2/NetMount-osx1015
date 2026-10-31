import { logger } from '../../../../services/LoggerService'

export function normalizeStorageId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\\s+/g, ' ')
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
    // A names-only response must use the names + info fallback endpoints.
    if (data.every(driver => typeof driver === 'string')) return 'unknown'
    return 'array'
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    const firstValue = entries[0]?.[1] as Record<string, unknown> | undefined
    if (firstValue && (firstValue.config || firstValue.common || firstValue.additional)) {
      return 'object-map'
    }
  }

  return 'unknown'
}

export function normalizeDriverList(data: unknown): Record<string, DriverInfo> {
  const structure = detectDriverListStructure(data)

  if (structure === 'object-map') {
    return data as Record<string, DriverInfo>
  }

  if (structure === 'array') {
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
