export type BakeLightConfig = {
  id: number
  name: string
  enabled: boolean
  x: number
  y: number
  z: number
  sourceRadius: number
  range: number
  intensity: number
  color: string
}

export const DEFAULT_BAKE_LIGHT_CONFIGS: readonly BakeLightConfig[] = [
  {
    id: 1,
    name: 'Point 1',
    enabled: true,
    x: -6.0,
    y: 4.9,
    z: -3.3,
    sourceRadius: 0.45,
    range: 14,
    intensity: 300,
    color: '#d9aa63',
  },
  {
    id: 2,
    name: 'Point 2',
    enabled: true,
    x: 8.3,
    y: 2.0,
    z: -0.2,
    sourceRadius: 0.45,
    range: 14,
    intensity: 300,
    color: '#3481e2',
  },
  {
    id: 3,
    name: 'Point 3',
    enabled: true,
    x: 8.6,
    y: 4.9,
    z: 3.2,
    sourceRadius: 0.45,
    range: 14,
    intensity: 100,
    color: '#f82424',
  },
  {
    id: 4,
    name: 'Point 4',
    enabled: true,
    x: -1.9,
    y: 1.3,
    z: 3.1,
    sourceRadius: 0.45,
    range: 14,
    intensity: 50,
    color: '#ffffff',
  },
]

export const createDefaultBakeLightConfigs = (): BakeLightConfig[] =>
  DEFAULT_BAKE_LIGHT_CONFIGS.map((config) => ({ ...config }))
