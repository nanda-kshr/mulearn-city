"use client";

import { Sky } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CityChunk, CityResident } from "@/app/lib/city-types";

type CitySceneCanvasProps = {
  chunks: CityChunk[];
  chunkSize: number;
  selectedMuid: string | null;
  controlsPaused: boolean;
  cameraFocusRequest: CameraFocusRequest | null;
  onSelect: (muid: string) => void;
  onHover: (muid: string | null) => void;
  onFocusChange?: (focused: boolean) => void;
  onPlayerChunkChange?: (chunkX: number, chunkZ: number) => void;
  onCameraFocusComplete?: (muid: string) => void;
};

type CameraFocusRequest = {
  id: number;
  muid: string;
};

type CameraFocusTarget = {
  muid: string;
  x: number;
  z: number;
  height: number;
};

type TowerLayout = {
  id: string;
  resident: CityResident;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: THREE.Color;
  emissiveIntensity: number;
  seed: number;
};

type TowerProps = {
  tower: TowerLayout;
  active: boolean;
  onSelect: (muid: string) => void;
  onHover: (muid: string | null) => void;
};

type InputKey =
  | "KeyW"
  | "KeyA"
  | "KeyS"
  | "KeyD"
  | "Space"
  | "ControlLeft"
  | "ControlRight";

type CameraAnimation = {
  commandId: number;
  muid: string;
  phase: "toCenter" | "toTower";
  elapsed: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromLookTarget: THREE.Vector3;
  toLookTarget: THREE.Vector3;
};

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return hash >>> 0;
}

function normalizeMuid(input: string): string {
  return input.trim().toLowerCase();
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

function buildTowerLayout(chunks: CityChunk[], chunkSize: number): TowerLayout[] {
  const layouts: TowerLayout[] = [];

  for (const chunk of chunks) {
    if (chunk.residents.length === 0) {
      continue;
    }

    const arrangedResidents = [...chunk.residents].sort((left, right) => {
      const leftHash = stableHash(`${chunk.key}:${left.muid}`);
      const rightHash = stableHash(`${chunk.key}:${right.muid}`);

      if (leftHash === rightHash) {
        return left.muid.localeCompare(right.muid);
      }

      return leftHash - rightHash;
    });

    const columns = Math.max(1, Math.ceil(Math.sqrt(arrangedResidents.length)));
    // Keep chunk-to-chunk gap equal to the intra-chunk building spacing.
    const spacing = Math.max(2.8, chunkSize / columns);
    const half = ((columns - 1) * spacing) / 2;

    arrangedResidents.forEach((resident, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const x = chunk.x * chunkSize + col * spacing - half;
      const z = chunk.z * chunkSize + row * spacing - half;
      const hue = Number.isFinite(resident.hue)
        ? THREE.MathUtils.euclideanModulo(resident.hue, 360)
        : 210;
      const glow = Number.isFinite(resident.glow) ? resident.glow : 14;
      const heightPct = Number.isFinite(resident.buildingHeight)
        ? resident.buildingHeight
        : 34;

      layouts.push({
        id: `${chunk.key}:${resident.muid}:${index}`,
        resident,
        x,
        z,
        width: 1.35 + (resident.recentEvents % 3) * 0.2,
        depth: 1.35 + (resident.totalEvents % 3) * 0.2,
        height: 1.9 + (Math.max(10, Math.min(100, heightPct)) / 100) * 11.5,
        color: new THREE.Color().setHSL(hue / 360, 0.63, 0.52),
        emissiveIntensity: Math.min(1.35, Math.max(0.14, 0.14 + glow / 65)),
        seed: hue / 45,
      });
    });
  }

  return layouts;
}

function Ground({ span }: { span: number }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[span, span]} />
        <meshStandardMaterial color="#2f3d4b" roughness={0.96} metalness={0.03} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[span * 0.18, span * 0.2, 64]} />
        <meshStandardMaterial
          color="#5d7389"
          transparent
          opacity={0.34}
          roughness={0.9}
          metalness={0.08}
        />
      </mesh>
    </>
  );
}

function Tower({ tower, active, onSelect, onHover }: TowerProps) {
  const towerRef = useRef<THREE.Mesh>(null);
  const beaconRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (towerRef.current) {
      const target = active ? 1.06 : 1;
      towerRef.current.scale.y = THREE.MathUtils.lerp(
        towerRef.current.scale.y,
        target,
        6 * delta,
      );
    }

    if (beaconRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.3 + tower.seed) * 0.18;
      beaconRef.current.scale.setScalar(pulse);
    }
  });

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(tower.resident.muid);
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(null);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(tower.resident.muid);
  };

  const base = Math.max(tower.width, tower.depth);

  return (
    <group position={[tower.x, 0, tower.z]}>
      <mesh
        ref={towerRef}
        position={[0, tower.height / 2, 0]}
        castShadow
        receiveShadow
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <boxGeometry args={[tower.width, tower.height, tower.depth]} />
        <meshStandardMaterial
          color={tower.color}
          emissive={tower.color}
          emissiveIntensity={active ? tower.emissiveIntensity + 0.28 : tower.emissiveIntensity}
          roughness={0.44}
          metalness={0.25}
        />
      </mesh>

      <mesh
        position={[0, tower.height * 0.52, tower.depth / 2 + 0.01]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <planeGeometry args={[tower.width * 0.72, tower.height * 0.8]} />
        <meshBasicMaterial color="#fff7ca" transparent opacity={0.16 + tower.emissiveIntensity * 0.2} />
      </mesh>

      <mesh ref={beaconRef} position={[0, tower.height + 0.36, 0]}>
        <sphereGeometry args={[0.18, 24, 24]} />
        <meshStandardMaterial
          color="#ffe5aa"
          emissive={tower.color}
          emissiveIntensity={active ? 1.6 : 1.1}
          roughness={0.22}
          metalness={0.1}
        />
      </mesh>

      {active ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
          <ringGeometry args={[base * 0.6, base * 0.88, 48]} />
          <meshBasicMaterial color="#fff4c7" transparent opacity={0.78} />
        </mesh>
      ) : null}
    </group>
  );
}

function FirstPersonController({
  citySpan,
  cityCenter,
  chunkSize,
  controlsPaused,
  cameraFocusRequest,
  cameraFocusTarget,
  onFocusChange,
  onPlayerChunkChange,
  onCameraFocusComplete,
}: {
  citySpan: number;
  cityCenter: { x: number; z: number };
  chunkSize: number;
  controlsPaused: boolean;
  cameraFocusRequest: CameraFocusRequest | null;
  cameraFocusTarget: CameraFocusTarget | null;
  onFocusChange?: (focused: boolean) => void;
  onPlayerChunkChange?: (chunkX: number, chunkZ: number) => void;
  onCameraFocusComplete?: (muid: string) => void;
}) {
  const { camera, gl } = useThree();
  const eyeHeight = 2.2;
  const playerRef = useRef(new THREE.Vector3(0, eyeHeight, 0));
  const velocityRef = useRef(new THREE.Vector3(0, 0, 0));
  const yawRef = useRef(0);
  const pitchRef = useRef(0.08);
  const inputRef = useRef<Record<InputKey, boolean>>({
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    Space: false,
    ControlLeft: false,
    ControlRight: false,
  });

  const lookDirection = useMemo(() => new THREE.Vector3(), []);
  const forwardDirection = useMemo(() => new THREE.Vector3(), []);
  const rightDirection = useMemo(() => new THREE.Vector3(), []);
  const upDirection = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const movementDirection = useMemo(() => new THREE.Vector3(), []);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const lastChunkRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 });
  const focusTargetRef = useRef<CameraFocusTarget | null>(cameraFocusTarget);
  const animationRef = useRef<CameraAnimation | null>(null);
  const processedCommandRef = useRef(0);

  const emitChunkIfNeeded = (position: THREE.Vector3) => {
    const chunkX = Math.round(position.x / chunkSize);
    const chunkZ = Math.round(position.z / chunkSize);
    if (chunkX !== lastChunkRef.current.x || chunkZ !== lastChunkRef.current.z) {
      lastChunkRef.current = { x: chunkX, z: chunkZ };
      onPlayerChunkChange?.(chunkX, chunkZ);
    }
  };

  useEffect(() => {
    const element = gl.domElement;
    const inputState = inputRef.current;
    camera.position.set(0, eyeHeight, 0);
    onPlayerChunkChange?.(0, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (controlsPaused || isEditableElement(event.target)) {
        return;
      }

      if (event.code in inputState) {
        inputState[event.code as InputKey] = true;
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (controlsPaused || isEditableElement(event.target)) {
        return;
      }

      if (event.code in inputState) {
        inputState[event.code as InputKey] = false;
      }
    };

    const handleClick = () => {
      if (controlsPaused) {
        return;
      }

      if (animationRef.current) {
        return;
      }

      if (document.pointerLockElement === element) {
        document.exitPointerLock();
        return;
      }

      if (typeof element.requestPointerLock === "function") {
        element.requestPointerLock();
      }
    };

    const handlePointerLockChange = () => {
      const focused = document.pointerLockElement === element;
      onFocusChange?.(focused);

      if (!focused) {
        inputState.KeyW = false;
        inputState.KeyA = false;
        inputState.KeyS = false;
        inputState.KeyD = false;
        inputState.Space = false;
        inputState.ControlLeft = false;
        inputState.ControlRight = false;
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== element) {
        return;
      }

      yawRef.current += event.movementX * 0.0024;
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - event.movementY * 0.0018,
        -1.35,
        1.35,
      );
    };

    const handleBlur = () => {
      inputState.KeyW = false;
      inputState.KeyA = false;
      inputState.KeyS = false;
      inputState.KeyD = false;
      inputState.Space = false;
      inputState.ControlLeft = false;
      inputState.ControlRight = false;
    };

    element.addEventListener("click", handleClick);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown, { passive: false });
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    onFocusChange?.(document.pointerLockElement === element);

    return () => {
      element.removeEventListener("click", handleClick);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      onFocusChange?.(false);
    };
  }, [camera, controlsPaused, gl, onFocusChange, onPlayerChunkChange]);

  useEffect(() => {
    if (!controlsPaused) {
      return;
    }

    const inputState = inputRef.current;
    inputState.KeyW = false;
    inputState.KeyA = false;
    inputState.KeyS = false;
    inputState.KeyD = false;
    inputState.Space = false;
    inputState.ControlLeft = false;
    inputState.ControlRight = false;
    velocityRef.current.set(0, 0, 0);

    const element = gl.domElement;
    if (document.pointerLockElement === element) {
      document.exitPointerLock();
    }
  }, [controlsPaused, gl]);

  useEffect(() => {
    focusTargetRef.current = cameraFocusTarget;
  }, [cameraFocusTarget]);

  useEffect(() => {
    if (!cameraFocusRequest) {
      return;
    }

    if (cameraFocusRequest.id === processedCommandRef.current) {
      return;
    }

    const focusTarget = cameraFocusTarget;
    if (
      !focusTarget ||
      normalizeMuid(focusTarget.muid) !== normalizeMuid(cameraFocusRequest.muid)
    ) {
      return;
    }

    processedCommandRef.current = cameraFocusRequest.id;

    const element = gl.domElement;
    if (document.pointerLockElement === element) {
      document.exitPointerLock();
    }

    const currentPosition = playerRef.current.clone();
    const currentLookDirection = new THREE.Vector3(
      Math.sin(yawRef.current) * Math.cos(pitchRef.current),
      Math.sin(pitchRef.current),
      -Math.cos(yawRef.current) * Math.cos(pitchRef.current),
    );
    const currentLookTarget = currentPosition.clone().add(currentLookDirection);
    const topPosition = new THREE.Vector3(
      cityCenter.x,
      Math.max(18, citySpan * 0.34),
      cityCenter.z,
    );
    const topLookTarget = new THREE.Vector3(cityCenter.x, 0, cityCenter.z);

    animationRef.current = {
      commandId: cameraFocusRequest.id,
      muid: cameraFocusRequest.muid,
      phase: "toCenter",
      elapsed: 0,
      duration: 1.05,
      fromPosition: currentPosition,
      toPosition: topPosition,
      fromLookTarget: currentLookTarget,
      toLookTarget: topLookTarget,
    };
  }, [cameraFocusRequest, cameraFocusTarget, cityCenter.x, cityCenter.z, citySpan, gl]);

  useFrame((_, delta) => {
    const activeAnimation = animationRef.current;
    if (activeAnimation) {
      activeAnimation.elapsed += delta;
      const progress = Math.min(1, activeAnimation.elapsed / activeAnimation.duration);
      const eased = 1 - (1 - progress) ** 3;

      playerRef.current.lerpVectors(
        activeAnimation.fromPosition,
        activeAnimation.toPosition,
        eased,
      );
      targetPosition.lerpVectors(
        activeAnimation.fromLookTarget,
        activeAnimation.toLookTarget,
        eased,
      );
      camera.position.copy(playerRef.current);
      camera.lookAt(targetPosition);
      emitChunkIfNeeded(playerRef.current);

      if (progress >= 1) {
        if (activeAnimation.phase === "toCenter") {
          const focusTarget = focusTargetRef.current;
          if (!focusTarget) {
            animationRef.current = null;
            return;
          }

          const approachDirection = new THREE.Vector3(
            focusTarget.x - cityCenter.x,
            0,
            focusTarget.z - cityCenter.z,
          );
          if (approachDirection.lengthSq() < 0.0001) {
            approachDirection.set(0, 0, -1);
          }
          approachDirection.normalize();

          const approachDistance = 8.4;
          const towerPosition = new THREE.Vector3(
            focusTarget.x,
            Math.max(1.2, focusTarget.height * 0.58),
            focusTarget.z,
          );
          const focusPosition = new THREE.Vector3(
            focusTarget.x - approachDirection.x * approachDistance,
            Math.max(4.4, focusTarget.height * 0.62 + 4.2),
            focusTarget.z - approachDirection.z * approachDistance,
          );

          animationRef.current = {
            commandId: activeAnimation.commandId,
            muid: activeAnimation.muid,
            phase: "toTower",
            elapsed: 0,
            duration: 1.15,
            fromPosition: playerRef.current.clone(),
            toPosition: focusPosition,
            fromLookTarget: targetPosition.clone(),
            toLookTarget: towerPosition,
          };
          return;
        }

        const finalLookDirection = targetPosition.clone().sub(playerRef.current).normalize();
        yawRef.current = Math.atan2(finalLookDirection.x, -finalLookDirection.z);
        pitchRef.current = THREE.MathUtils.clamp(
          Math.asin(finalLookDirection.y),
          -1.35,
          1.35,
        );
        velocityRef.current.set(0, 0, 0);
        animationRef.current = null;
        onCameraFocusComplete?.(activeAnimation.muid);
      }

      return;
    }

    if (controlsPaused) {
      velocityRef.current.set(0, 0, 0);
      return;
    }

    lookDirection.set(
      Math.sin(yawRef.current) * Math.cos(pitchRef.current),
      Math.sin(pitchRef.current),
      -Math.cos(yawRef.current) * Math.cos(pitchRef.current),
    );

    forwardDirection.set(Math.sin(yawRef.current), 0, -Math.cos(yawRef.current)).normalize();
    rightDirection.set(-forwardDirection.z, 0, forwardDirection.x).normalize();

    const inputState = inputRef.current;
    const inputForward = (inputState.KeyW ? 1 : 0) - (inputState.KeyS ? 1 : 0);
    const inputRight = (inputState.KeyD ? 1 : 0) - (inputState.KeyA ? 1 : 0);
    const inputVertical = (inputState.Space ? 1 : 0) - (
      inputState.ControlLeft || inputState.ControlRight ? 1 : 0
    );

    movementDirection.set(0, 0, 0);
    movementDirection.addScaledVector(forwardDirection, inputForward);
    movementDirection.addScaledVector(rightDirection, inputRight);
    movementDirection.addScaledVector(upDirection, inputVertical);

    if (movementDirection.lengthSq() > 0) {
      movementDirection.normalize();
    }

    const moveSpeed = 13;
    velocityRef.current.lerp(
      movementDirection.multiplyScalar(moveSpeed),
      1 - Math.exp(-delta * 10),
    );

    playerRef.current.addScaledVector(velocityRef.current, delta);

    playerRef.current.y = THREE.MathUtils.clamp(
      playerRef.current.y,
      1.4,
      Math.max(12, citySpan * 0.32),
    );

    camera.position.copy(playerRef.current);
    targetPosition.copy(playerRef.current).add(lookDirection);
    camera.lookAt(targetPosition);

    emitChunkIfNeeded(playerRef.current);
  });

  return null;
}

function CitySceneCanvas({
  chunks,
  chunkSize,
  selectedMuid,
  controlsPaused,
  cameraFocusRequest,
  onSelect,
  onHover,
  onFocusChange,
  onPlayerChunkChange,
  onCameraFocusComplete,
}: CitySceneCanvasProps) {
  const towers = useMemo(() => buildTowerLayout(chunks, chunkSize), [chunks, chunkSize]);
  const maxChunkDistance = useMemo(
    () =>
      chunks.reduce(
        (maxDistance, chunk) =>
          Math.max(maxDistance, Math.abs(chunk.x), Math.abs(chunk.z)),
        0,
      ),
    [chunks],
  );
  const citySpan = Math.max(40, (maxChunkDistance + 2) * chunkSize * 2);
  const cityCenter = useMemo(() => {
    if (chunks.length === 0) {
      return { x: 0, z: 0 };
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const chunk of chunks) {
      const chunkCenterX = chunk.x * chunkSize;
      const chunkCenterZ = chunk.z * chunkSize;
      minX = Math.min(minX, chunkCenterX - chunkSize / 2);
      maxX = Math.max(maxX, chunkCenterX + chunkSize / 2);
      minZ = Math.min(minZ, chunkCenterZ - chunkSize / 2);
      maxZ = Math.max(maxZ, chunkCenterZ + chunkSize / 2);
    }

    return {
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
    };
  }, [chunks, chunkSize]);

  const cameraFocusTarget = useMemo<CameraFocusTarget | null>(() => {
    if (!cameraFocusRequest) {
      return null;
    }

    const targetTower =
      towers.find(
        (tower) =>
          normalizeMuid(tower.resident.muid) === normalizeMuid(cameraFocusRequest.muid),
      ) ?? null;
    if (!targetTower) {
      return null;
    }

    return {
      muid: targetTower.resident.muid,
      x: targetTower.x,
      z: targetTower.z,
      height: targetTower.height,
    };
  }, [cameraFocusRequest, towers]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.8]}
      camera={{
        position: [0, 2.2, 0],
        fov: 46,
        near: 0.1,
        far: 260,
      }}
      onPointerMissed={() => onHover(null)}
    >
      <color attach="background" args={["#cfe7ff"]} />
      <fog attach="fog" args={["#cfe7ff", citySpan * 0.65, citySpan * 2.5]} />

      <Sky
        distance={320}
        sunPosition={[18, 16, 9]}
        turbidity={8.2}
        rayleigh={1.35}
        mieCoefficient={0.005}
        mieDirectionalG={0.84}
      />

      <ambientLight intensity={0.48} />
      <hemisphereLight args={["#f0fbff", "#3c5268", 0.72]} />
      <pointLight position={[0, 12, 0]} color="#ffd8a3" intensity={0.24} />
      <directionalLight
        castShadow
        position={[18, 26, 10]}
        intensity={1.15}
        shadow-mapSize-width={1536}
        shadow-mapSize-height={1536}
      />

      <Ground span={citySpan * 2.1} />

      {towers.map((tower) => (
        <Tower
          key={tower.id}
          tower={tower}
          active={tower.resident.muid === selectedMuid}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}

      <FirstPersonController
        citySpan={citySpan}
        cityCenter={cityCenter}
        chunkSize={chunkSize}
        controlsPaused={controlsPaused}
        cameraFocusRequest={cameraFocusRequest}
        cameraFocusTarget={cameraFocusTarget}
        onFocusChange={onFocusChange}
        onPlayerChunkChange={onPlayerChunkChange}
        onCameraFocusComplete={onCameraFocusComplete}
      />
    </Canvas>
  );
}

export default memo(CitySceneCanvas);
