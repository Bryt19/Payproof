"use client";

import React, { useRef, useEffect, useMemo, Suspense, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { GlassOrb } from "./glass-orb";

declare global {
  interface Window {
    __orbPointerTarget?: [number, number];
  }
}

type GlassOrbFallbackProps = {
  pulse?: boolean;
  className?: string;
};

const GlassOrbFallback: React.FC<GlassOrbFallbackProps> = ({
  pulse = true,
  className = "",
}) => (
  <div
    className={`relative flex items-center justify-center w-full aspect-square ${className}`}
    aria-hidden="true"
  >
    <GlassOrb className="w-full h-full" />
  </div>
);


const PURPLE = "#9945FF";
const MAGENTA = "#C14BF0";
const GREEN = "#14F195";

/* ------------------------------------------------------------------ */
/*  Inner ribbon texture (purple → magenta → green)                 */
/* ------------------------------------------------------------------ */
function makeRibbonTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0.0, PURPLE);
  grad.addColorStop(0.5, MAGENTA);
  grad.addColorStop(1.0, GREEN);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/*  Background glow — big soft radial gradient sphere behind the orb */
/*  Gives the transmission something soft to bend / refract.         */
/* ------------------------------------------------------------------ */
function BackgroundGlow() {
  const tex = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    grad.addColorStop(0.0, "rgba(120, 70, 180, 0.55)");
    grad.addColorStop(0.35, "rgba(50, 30, 90, 0.28)");
    grad.addColorStop(1.0, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, []);

  if (!tex) return null;

  return (
    <mesh scale={14}>
      <sphereGeometry args={[7, 40, 32]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={1}
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner flowing ribbon core (thin torus knot)                     */
/* ------------------------------------------------------------------ */
function InnerRibbon({ mobile, tex }: { mobile: boolean; tex: THREE.CanvasTexture | null }) {
  const group = useRef<THREE.Group>(null);

  const curveSegments = mobile ? 56 : 96;
  const tubeSegments = mobile ? 14 : 22;

  useFrame((_, t) => {
    if (!group.current) return;
    group.current.rotation.x = Math.sin(t * 0.22) * 0.18;
    group.current.rotation.y = t * 0.12;
    group.current.rotation.z = Math.cos(t * 0.18) * 0.12;
  });

  const mainMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: tex ?? undefined,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: "#ffffff",
      }),
    [tex],
  );

  return (
    <group ref={group} scale={mobile ? 0.82 : 1}>
      <mesh>
        <torusKnotGeometry args={[0.52, 0.18, curveSegments, tubeSegments, 2, 3]} />
        <primitive object={mainMat} attach="material" />
      </mesh>
      {/* thinner secondary ribbon for richness */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusKnotGeometry args={[0.62, 0.06, 64, 12, 3, 4]} />
        <meshBasicMaterial
          color={MAGENTA}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  The glass sphere itself                                            */
/* ------------------------------------------------------------------ */
function GlassSphere({ mobile, tex }: { mobile: boolean; tex: THREE.CanvasTexture | null }) {
  const mat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        transmission: mobile ? 0.6 : 0.92,
        thickness: 0.85,
        roughness: mobile ? 0.08 : 0.05,
        metalness: 0,
        ior: 1.4,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
        iridescence: mobile ? 0.35 : 0.55,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [120, 420],
        transparent: true,
        opacity: 0.97,
        side: THREE.DoubleSide,
        envMapIntensity: mobile ? 0.7 : 1.1,
        specularIntensity: 0.6,
        specularColor: new THREE.Color(PURPLE),
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    [mobile, tex],
  );

  return (
    <mesh>
      <sphereGeometry args={[1, mobile ? 48 : 72, mobile ? 32 : 52]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene: lights + environment + orb group (animated)              */
/* ------------------------------------------------------------------ */
function Scene({ mobile, tex }: { mobile: boolean; tex: THREE.CanvasTexture | null }) {
  const { camera } = useThree();
  const mouse = useRef([0, 0]);
  const camTarget = useRef([0, 0]);
  const group = useRef<THREE.Group>(null);

  useFrame((_, t) => {
    if (!group.current) return;
    group.current.rotation.y = t * 0.15;
    group.current.position.y = Math.sin(t * 0.55) * 0.05;

    camTarget.current[0] += (mouse.current[0] * 0.45 - camTarget.current[0]) * 0.06;
    camTarget.current[1] += (mouse.current[1] * 0.3 - camTarget.current[1]) * 0.06;
    camera.position.x = camTarget.current[0];
    camera.position.y = camTarget.current[1];
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <ambientLight intensity={mobile ? 0.18 : 0.22} />

      {/* Purple rim light */}
      <pointLight
        color={PURPLE}
        intensity={mobile ? 2.4 : 3.2}
        distance={8}
        position={[-2.6, 1.4, 1.8]}
        decay={1.5}
      />

      {/* Green rim light */}
      <pointLight
        color={GREEN}
        intensity={mobile ? 2.4 : 3.2}
        distance={8}
        position={[2.6, -1.4, 1.8]}
        decay={1.5}
      />

      {/* Soft white fill */}
      <pointLight
        color="#ffffff"
        intensity={mobile ? 0.35 : 0.55}
        distance={6}
        position={[0, 0.6, 3.2]}
        decay={1.5}
      />

      {/* Studio environment map */}
      <Environment preset="studio" background={false} blur={0.8} environmentIntensity={mobile ? 0.7 : 1.0} />

      {/* Soft radial glow behind everything */}
      <BackgroundGlow />

      {/* Orb group: glass shell + glowing ribbon core */}
      <group ref={group}>
        <GlassSphere mobile={mobile} tex={tex} />
        <InnerRibbon mobile={mobile} tex={tex} />
      </group>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Public component: lazy-ready 3D orb with fallback               */
/* ------------------------------------------------------------------ */
export function GlassOrb3D({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [noWebGL, setNoWebGL] = useState(false);
  const [mobile, setMobile] = useState(false);
  const ptrMoveCapture = (e: THREE.Event & { clientX?: number; clientY?: number }) => {
    if (typeof window === "undefined") return;
    window.__orbPointerTarget = [
      typeof e.clientX === "number" ? e.clientX : 0,
      typeof e.clientY === "number" ? e.clientY : 0,
    ];
  };

  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  const visibilityRef = useRef(true);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    setMobile(
      window.matchMedia("(max-width: 768px)").matches ||
        /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    );

    try {
      const c = document.createElement("canvas");
      setNoWebGL(
        !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl"))
          ? false
          : true,
      );
    } catch {
      setNoWebGL(true);
    }

    const ribbonTex = makeRibbonTexture();
    setTex(ribbonTex ?? null);

    setReady(true);

    return () => {
      if (ribbonTex) {
        ribbonTex.dispose();
      }
    };
  }, []);

  // Pause the render loop when the orb is off-screen
  useEffect(() => {
    if (!containerRef.current || noWebGL || reduced || !ready) return;
    const el = containerRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibilityRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [noWebGL, reduced, ready]);

  const shouldRender3D = ready && !reduced && !noWebGL && visibilityRef.current;

  if (!shouldRender3D) {
    return (
      <div
        className={`relative flex items-center justify-center w-full aspect-square ${className ?? ""}`}
        aria-hidden="true"
      >
        <GlassOrbFallback pulse={false} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`w-full aspect-square ${className ?? ""}`}>
      <Canvas
        camera={{ position: [0, 0, 3.4], fov: 38, near: 0.1, far: 20 }}
        gl={{
          antialias: !mobile,
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,           depth: true,
        }}
        dpr={[1, mobile ? 1 : 2]}
        shadows
      >
        <Suspense fallback={null}>
          <Scene mobile={mobile} tex={tex} />
        </Suspense>
      </Canvas>
    </div>
  );
}