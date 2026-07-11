export type BakeLightType = 'point' | 'spot' | 'directional' | 'rectArea'

export type BakeLightConfig = {
  id: number
  name: string
  enabled: boolean
  type: BakeLightType
  x: number
  y: number
  z: number
  rotationX: number
  rotationY: number
  rotationZ: number
  sourceRadius: number
  angularRadius: number
  range: number
  intensity: number
  color: string
  innerConeAngle: number
  outerConeAngle: number
  width: number
  height: number
}

export const DEFAULT_BAKE_LIGHT_CONFIGS: readonly BakeLightConfig[] = [
  {
    id: 1,
    name: 'Point 1',
    enabled: true,
    type: 'point',
    x: -6.0,
    y: 4.9,
    z: -3.3,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sourceRadius: 0.45,
    angularRadius: 0.27,
    range: 14,
    intensity: 300,
    color: '#d9aa63',
    innerConeAngle: 30,
    outerConeAngle: 45,
    width: 2,
    height: 1,
  },
  {
    id: 2,
    name: 'Point 2',
    enabled: true,
    type: 'point',
    x: 8.3,
    y: 2.0,
    z: -0.2,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sourceRadius: 0.45,
    angularRadius: 0.27,
    range: 14,
    intensity: 300,
    color: '#3481e2',
    innerConeAngle: 30,
    outerConeAngle: 45,
    width: 2,
    height: 1,
  },
  {
    id: 3,
    name: 'Point 3',
    enabled: true,
    type: 'point',
    x: 8.6,
    y: 4.9,
    z: 3.2,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sourceRadius: 0.45,
    angularRadius: 0.27,
    range: 14,
    intensity: 100,
    color: '#f82424',
    innerConeAngle: 30,
    outerConeAngle: 45,
    width: 2,
    height: 1,
  },
  {
    id: 4,
    name: 'Point 4',
    enabled: true,
    type: 'point',
    x: -1.9,
    y: 1.3,
    z: 3.1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sourceRadius: 0.45,
    angularRadius: 0.27,
    range: 14,
    intensity: 50,
    color: '#ffffff',
    innerConeAngle: 30,
    outerConeAngle: 45,
    width: 2,
    height: 1,
  },
  {
    id: 5,
    name: 'Light 5',
    enabled: true,
    type: 'spot',
    x: -7.0,
    y: 6.8,
    z: 3.9,
    rotationX: -90,
    rotationY: 180,
    rotationZ: 0,
    sourceRadius: 0.45,
    angularRadius: 0.27,
    range: 14,
    intensity: 300,
    color: '#d9aa63',
    innerConeAngle: 30,
    outerConeAngle: 45,
    width: 2,
    height: 1,
  },
]

export const createDefaultBakeLightConfigs = (): BakeLightConfig[] =>
  DEFAULT_BAKE_LIGHT_CONFIGS.map((config) => ({ ...config }))
