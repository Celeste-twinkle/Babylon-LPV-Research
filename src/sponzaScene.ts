import '@babylonjs/loaders/glTF'

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Engine } from '@babylonjs/core/Engines/engine'
import { LightConstants } from '@babylonjs/core/Lights/lightConstants'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { Scene } from '@babylonjs/core/scene'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'

import type { Vec3Tuple } from './irradianceVolume'
import { vector3ToTuple } from './irradianceVolume'

export const SPONZA_MODEL_PATH = 'assets/sponza/glTF/Sponza.gltf'
const MAX_DEVICE_PIXEL_RATIO = 2

export type SceneBounds = {
  min: Vector3
  max: Vector3
  center: Vector3
  size: Vector3
  radius: number
}

export type SponzaApp = {
  engine: AbstractEngine
  scene: Scene
  camera: ArcRotateCamera
  bakeLight: PointLight
  importedMeshes: AbstractMesh[]
  bounds: SceneBounds
  usingWebGPU: boolean
  dispose: () => void
}

export const createSponzaApp = async (
  canvas: HTMLCanvasElement,
  onStatus: (message: string, isError?: boolean) => void,
  preferWebGPU = false,
): Promise<SponzaApp> => {
  const usingWebGPU = preferWebGPU && 'gpu' in navigator
  const engine = usingWebGPU
    ? await WebGPUEngine.CreateAsync(canvas, {
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    : new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    })
  applyDevicePixelRatio(engine)

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.015, 0.017, 0.022, 1)
  scene.environmentIntensity = 0.58

  const camera = new ArcRotateCamera(
    'camera',
    Math.PI * 0.74,
    Math.PI * 0.36,
    18,
    new Vector3(0, 3, 0),
    scene,
  )
  camera.attachControl(canvas, true)
  applySandboxCameraControls(camera)
  camera.lowerRadiusLimit = 1
  camera.upperRadiusLimit = 160

  const bakeLight = new PointLight('bake-point-light', new Vector3(0, 3.0, 0), scene)
  bakeLight.intensityMode = LightConstants.INTENSITYMODE_LUMINOUSINTENSITY
  bakeLight.falloffType = LightConstants.FALLOFF_PHYSICAL
  bakeLight.diffuse = new Color3(1.0, 0.72, 0.42)
  bakeLight.intensity = 900
  bakeLight.range = 14

  onStatus('Loading Sponza glTF...')
  const importResult = await SceneLoader.ImportMeshAsync(
    '',
    assetUrl('assets/sponza/glTF/'),
    'Sponza.gltf',
    scene,
  )
  const importedMeshes = importResult.meshes.filter((mesh) => mesh.getTotalVertices() > 0)

  if (importedMeshes.length === 0) {
    throw new Error(`No renderable meshes were loaded from ${SPONZA_MODEL_PATH}.`)
  }

  const bounds = computeBounds(importedMeshes)
  frameCamera(camera, bounds)
  syncSandboxCameraMotion(camera)

  const cameraMotionObserver = camera.onViewMatrixChangedObservable.add(() => {
    syncSandboxCameraMotion(camera)
  })

  onStatus(`Sponza ready: ${importedMeshes.length} meshes`)

  let lastDevicePixelRatio = getEffectiveDevicePixelRatio()
  const resize = (): void => {
    const nextDevicePixelRatio = getEffectiveDevicePixelRatio()

    if (nextDevicePixelRatio !== lastDevicePixelRatio) {
      lastDevicePixelRatio = nextDevicePixelRatio
      applyDevicePixelRatio(engine)
    }

    engine.resize()
  }
  window.addEventListener('resize', resize)
  window.visualViewport?.addEventListener('resize', resize)

  return {
    engine,
    scene,
    camera,
    bakeLight,
    importedMeshes,
    bounds,
    usingWebGPU,
    dispose: () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      camera.onViewMatrixChangedObservable.remove(cameraMotionObserver)
      scene.dispose()
      engine.dispose()
    },
  }
}

export const volumeBoundsFromScene = (bounds: SceneBounds): { min: Vec3Tuple; max: Vec3Tuple } => {
  const horizontalPadding = Math.max(bounds.size.x, bounds.size.z) * 0.04
  const min = new Vector3(
    bounds.min.x + horizontalPadding,
    bounds.min.y + Math.max(0.25, bounds.size.y * 0.03),
    bounds.min.z + horizontalPadding,
  )
  const max = new Vector3(
    bounds.max.x - horizontalPadding,
    bounds.min.y + Math.max(2.5, bounds.size.y * 0.72),
    bounds.max.z - horizontalPadding,
  )

  return {
    min: vector3ToTuple(min),
    max: vector3ToTuple(max),
  }
}

const computeBounds = (meshes: AbstractMesh[]): SceneBounds => {
  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true)
    const box = mesh.getBoundingInfo().boundingBox
    min.minimizeInPlace(box.minimumWorld)
    max.maximizeInPlace(box.maximumWorld)
  }

  const size = max.subtract(min)
  const center = min.add(size.scale(0.5))
  const radius = Math.max(1, size.length() * 0.5)

  return { min, max, center, size, radius }
}

const frameCamera = (camera: ArcRotateCamera, bounds: SceneBounds): void => {
  camera.setTarget(bounds.center.add(new Vector3(0, bounds.size.y * 0.08, 0)))
  camera.radius = Math.max(bounds.size.x, bounds.size.z) * 0.82
  camera.lowerRadiusLimit = bounds.radius * 0.08
  camera.upperRadiusLimit = camera.radius * 5
  camera.minZ = 0.05
  camera.maxZ = bounds.radius * 8
}

const applySandboxCameraControls = (camera: ArcRotateCamera): void => {
  camera.fov = 0.8
  camera.angularSensibilityX = 1000
  camera.angularSensibilityY = 1000
  camera.wheelPrecision = 3
  camera.wheelDeltaPercentage = 0.01
  camera.pinchDeltaPercentage = 0.01
  camera.useNaturalPinchZoom = false
}

const syncSandboxCameraMotion = (camera: ArcRotateCamera): void => {
  camera.panningSensibility = 5000 / Math.max(camera.radius, 0.001)
  camera.pinchPrecision = 200 / Math.max(camera.radius, 0.001)
  camera.speed = camera.radius * 0.2
}

const assetUrl = (path: string): string => {
  const base = import.meta.env.BASE_URL

  return `${base}${path}`.replace(/\/{2,}/g, '/')
}

const getEffectiveDevicePixelRatio = (): number => {
  const dpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1

  return Math.min(MAX_DEVICE_PIXEL_RATIO, Math.max(1, dpr))
}

const applyDevicePixelRatio = (engine: AbstractEngine): void => {
  const effectiveDpr = getEffectiveDevicePixelRatio()

  engine.setHardwareScalingLevel(1 / effectiveDpr)
}
