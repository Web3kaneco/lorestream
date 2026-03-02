'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

export type AnimationState = 'idle' | 'speaking' | 'thinking' | 'greeting';

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
  animationState?: AnimationState;
}

// Animation clip name → state mapping keywords
const CLIP_STATE_KEYWORDS: Record<AnimationState, string[]> = {
  idle: ['idle', 'breathing', 'standing', 'rest'],
  speaking: ['talk', 'speak', 'gesture', 'conversation', 'explain'],
  thinking: ['think', 'look', 'scratch', 'weight', 'shift', 'wonder'],
  greeting: ['wave', 'greet', 'salute', 'nod', 'hello', 'welcome'],
};

const CROSSFADE_DURATION = 0.4;

function categorizeClips(clips: THREE.AnimationClip[]): Map<AnimationState, THREE.AnimationClip> {
  const map = new Map<AnimationState, THREE.AnimationClip>();
  if (clips.length === 0) return map;
  for (const [state, keywords] of Object.entries(CLIP_STATE_KEYWORDS) as [AnimationState, string[]][]) {
    for (const clip of clips) {
      const n = clip.name.toLowerCase();
      if (keywords.some(kw => n.includes(kw))) { map.set(state, clip); break; }
    }
  }
  const fb = clips[0];
  for (const s of ['idle', 'speaking', 'thinking', 'greeting'] as AnimationState[]) {
    if (!map.has(s)) map.set(s, fb);
  }
  return map;
}

function repairTrackNames(clips: THREE.AnimationClip[], boneNames: Set<string>): number {
  let repaired = 0;
  const bnArray = Array.from(boneNames);
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const di = track.name.lastIndexOf('.');
      if (di < 0) continue;
      const bn = track.name.substring(0, di);
      const pp = track.name.substring(di); // .quaternion, .position, .scale
      if (boneNames.has(bn)) continue;

      let fixed = false;
      // Strategy 1: Strip known prefixes (Blender export artifacts)
      for (const pfx of ['Armature.', 'Armature/', 'Scene.', 'Scene/', 'Object.', 'Object/']) {
        if (bn.startsWith(pfx)) {
          const stripped = bn.substring(pfx.length);
          if (boneNames.has(stripped)) { track.name = stripped + pp; repaired++; fixed = true; break; }
        }
      }
      if (fixed) continue;

      // Strategy 2: Extract last segment of hierarchical path
      // Handles "Armature/Root/Hip/Waist.quaternion" → "Waist"
      const segments = bn.split(/[./\\]/);
      for (let i = segments.length - 1; i >= 0; i--) {
        if (boneNames.has(segments[i])) {
          track.name = segments[i] + pp;
          repaired++; fixed = true; break;
        }
      }
      if (fixed) continue;

      // Strategy 3: Case-insensitive match on last segment
      const lastSeg = segments[segments.length - 1].toLowerCase();
      const ciMatch = bnArray.find(b => b.toLowerCase() === lastSeg);
      if (ciMatch) { track.name = ciMatch + pp; repaired++; }
    }
  }
  return repaired;
}

export function Avatar({ modelUrl, volumeRef, animationState = 'idle' }: AvatarProps) {
  const { scene, animations: modelAnimations } = useGLTF(modelUrl);

  const groupRef = useRef<THREE.Group>(null!);

  // Bone refs — only used for head, jaw, and lip sync
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const neckBoneRef = useRef<THREE.Bone | null>(null);
  const jawBoneRef = useRef<THREE.Bone | null>(null);
  const lipTopRef = useRef<THREE.Bone | null>(null);
  const lipBottomRef = useRef<THREE.Bone | null>(null);
  const lipTopLRef = useRef<THREE.Bone | null>(null);
  const lipTopRRef = useRef<THREE.Bone | null>(null);
  const lipBottomLRef = useRef<THREE.Bone | null>(null);
  const lipBottomRRef = useRef<THREE.Bone | null>(null);
  const lipsLRef = useRef<THREE.Bone | null>(null);
  const lipsRRef = useRef<THREE.Bone | null>(null);
  const hasFullMouthRigRef = useRef(false);

  // Arm bone refs (for T-pose fix)
  const armLRef = useRef<THREE.Bone | null>(null);
  const armRRef = useRef<THREE.Bone | null>(null);
  const forearmLRef = useRef<THREE.Bone | null>(null);
  const forearmRRef = useRef<THREE.Bone | null>(null);
  const armLRestQ = useRef<THREE.Quaternion | null>(null);
  const armRRestQ = useRef<THREE.Quaternion | null>(null);
  const forearmLRestQ = useRef<THREE.Quaternion | null>(null);
  const forearmRRestQ = useRef<THREE.Quaternion | null>(null);

  // Pre-computed arm relaxation quaternions (rotate arms down from T-pose)
  const armFixL = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.85), []);
  const armFixR = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.85), []);
  const forearmFixL = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3), []);
  const forearmFixR = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.3), []);

  // Direct SkinnedMesh + skeleton ref (bypasses potential reference mismatch)
  const skinnedMeshRef = useRef<THREE.SkinnedMesh | null>(null);
  const skelBonesMapRef = useRef<Map<string, THREE.Bone>>(new Map());

  // Diagnostic frame counter
  const diagFrameRef = useRef(0);

  // Smoothed viseme channels
  const smoothJawRef = useRef(0);
  const smoothWidthRef = useRef(0);
  const smoothVolRef = useRef(0);

  // Base rotations (captured once, used as anchor)
  const headBaseRotRef = useRef<THREE.Euler | null>(null);
  const neckBaseRotRef = useRef<THREE.Euler | null>(null);
  const lipsLBaseRotRef = useRef<THREE.Euler | null>(null);
  const lipsRBaseRotRef = useRef<THREE.Euler | null>(null);

  // AnimationMixer + clip management
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clipMapRef = useRef<Map<AnimationState, THREE.AnimationClip>>(new Map());
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentAnimStateRef = useRef<AnimationState>('idle');
  const hasClipAnimRef = useRef(false);

  // Synthetic mouth
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);
  const mouthGeo = useMemo(() => { const g = new THREE.SphereGeometry(1, 16, 8); g.scale(1.5, 0.6, 0.5); return g; }, []);
  const mouthMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x1a0a0a, transparent: true, opacity: 0.85, depthWrite: false }), []);

  // =========================================================
  // EFFECT 1: Scan skeleton for head/jaw/lip bones only
  // Body animation handled at group level (no mesh artifacts)
  // =========================================================
  useEffect(() => {
    headBoneRef.current = null;
    neckBoneRef.current = null;
    jawBoneRef.current = null;
    lipTopRef.current = null;
    lipBottomRef.current = null;
    lipTopLRef.current = null;
    lipTopRRef.current = null;
    lipBottomLRef.current = null;
    lipBottomRRef.current = null;
    lipsLRef.current = null;
    lipsRRef.current = null;
    hasFullMouthRigRef.current = false;
    headBaseRotRef.current = null;
    neckBaseRotRef.current = null;
    lipsLBaseRotRef.current = null;
    lipsRBaseRotRef.current = null;
    armLRef.current = null;
    armRRef.current = null;
    forearmLRef.current = null;
    forearmRRef.current = null;
    armLRestQ.current = null;
    armRRestQ.current = null;
    forearmLRestQ.current = null;
    forearmRRestQ.current = null;

    const allBoneNames: string[] = [];
    const mouthBoneMap: Record<string, React.MutableRefObject<THREE.Bone | null>> = {
      // Blender dot convention (original rig names)
      'lip.T': lipTopRef, 'lip.B': lipBottomRef,
      'lip.T.L': lipTopLRef, 'lip.T.R': lipTopRRef,
      'lip.B.L': lipBottomLRef, 'lip.B.R': lipBottomRRef,
      'lips.L': lipsLRef, 'lips.R': lipsRRef,
      // GLB export convention (dots stripped — Tripo/generic exporters)
      'lipT': lipTopRef, 'lipB': lipBottomRef,
      'lipTL': lipTopLRef, 'lipTR': lipTopRRef,
      'lipBL': lipBottomLRef, 'lipBR': lipBottomRRef,
      'lipsL': lipsLRef, 'lipsR': lipsRRef,
    };

    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const bone = child as THREE.Bone;
        allBoneNames.push(bone.name);
        const lname = bone.name.toLowerCase();

        if (lname.includes('head') && !lname.includes('headtop') && !lname.includes('head_end') && !headBoneRef.current)
          headBoneRef.current = bone;
        if (lname.includes('neck') && !lname.includes('necklace') && !neckBoneRef.current)
          neckBoneRef.current = bone;
        if ((lname === 'jaw' || lname.includes('jaw') || lname.includes('chin') || lname.includes('mandible')) && !jawBoneRef.current)
          jawBoneRef.current = bone;
        if ((lname.includes('lips') || lname.includes('lip')) && !lname.includes('headtop')) {
          if ((lname.includes('.l') || lname.includes('_l') || lname.includes('left')) && !lipsLRef.current) lipsLRef.current = bone;
          if ((lname.includes('.r') || lname.includes('_r') || lname.includes('right')) && !lipsRRef.current) lipsRRef.current = bone;
        }

        // Exact match for Blender mouth rig
        const mRef = mouthBoneMap[bone.name];
        if (mRef) mRef.current = bone;

        // Arm bones (exact name match for Tripo convention)
        if (bone.name === 'L_Upperarm') armLRef.current = bone;
        if (bone.name === 'R_Upperarm') armRRef.current = bone;
        if (bone.name === 'L_Forearm') forearmLRef.current = bone;
        if (bone.name === 'R_Forearm') forearmRRef.current = bone;
      }
    });

    // Capture arm rest quaternions BEFORE any animation
    if (armLRef.current) armLRestQ.current = armLRef.current.quaternion.clone();
    if (armRRef.current) armRRestQ.current = armRRef.current.quaternion.clone();
    if (forearmLRef.current) forearmLRestQ.current = forearmLRef.current.quaternion.clone();
    if (forearmRRef.current) forearmRRestQ.current = forearmRRef.current.quaternion.clone();

    hasFullMouthRigRef.current = !!(jawBoneRef.current && lipsLRef.current && lipsRRef.current);

    // Check SkinnedMesh binding
    let skinnedCount = 0;
    scene.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = child as THREE.SkinnedMesh;
        skinnedCount++;
        console.log(`  SkinnedMesh: "${sm.name}" skeleton.bones=${sm.skeleton?.bones.length ?? 0}`);
      }
    });

    console.log(`%c[AVATAR] ${allBoneNames.length} bones found, ${skinnedCount} SkinnedMesh(es)`, 'color: #d4af37; font-weight: bold');
    console.log(`  Bones: ${allBoneNames.join(', ')}`);
    console.log(`  Head=${headBoneRef.current?.name ?? 'MISS'} Neck=${neckBoneRef.current?.name ?? 'MISS'} Jaw=${jawBoneRef.current?.name ?? 'MISS'}`);
    console.log(`  Arms: L=${armLRef.current?.name ?? 'MISS'} R=${armRRef.current?.name ?? 'MISS'} ForeL=${forearmLRef.current?.name ?? 'MISS'} ForeR=${forearmRRef.current?.name ?? 'MISS'}`);
    console.log(`  LipsL=${lipsLRef.current?.name ?? 'MISS'} LipsR=${lipsRRef.current?.name ?? 'MISS'} LipT=${lipTopRef.current?.name ?? 'MISS'} LipB=${lipBottomRef.current?.name ?? 'MISS'}`);
    console.log(`  MouthRig=${hasFullMouthRigRef.current ? 'FULL' : 'NONE'} (jaw+lipsL+lipsR required)`);
  }, [scene]);

  // =========================================================
  // EFFECT 2: AnimationMixer (only if model has own clips)
  // =========================================================
  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current.uncacheRoot(scene);
      mixerRef.current = null;
    }
    currentActionRef.current = null;
    currentAnimStateRef.current = 'idle';
    clipMapRef.current = new Map();
    hasClipAnimRef.current = false;

    if (modelAnimations && modelAnimations.length > 0) {
      const boneNames = new Set<string>();
      scene.traverse((c) => { if ((c as THREE.Bone).isBone) boneNames.add(c.name); });
      const repairedCount = repairTrackNames(modelAnimations, boneNames);
      if (repairedCount > 0) console.log(`%c[AVATAR] Repaired ${repairedCount} animation track names`, 'color: #ffa500');

      // Diagnostic: check each clip's tracks against actual bones
      let totalBound = 0, totalUnbound = 0;
      for (const clip of modelAnimations) {
        let bound = 0, unbound = 0;
        const unboundNames: string[] = [];
        for (const track of clip.tracks) {
          const di = track.name.lastIndexOf('.');
          const bn = di >= 0 ? track.name.substring(0, di) : track.name;
          if (scene.getObjectByName(bn)) { bound++; } else { unbound++; unboundNames.push(track.name); }
        }
        totalBound += bound;
        totalUnbound += unbound;
        console.log(`  Clip "${clip.name}" dur=${clip.duration.toFixed(2)}s tracks=${clip.tracks.length} bound=${bound} unbound=${unbound}`);
        if (unboundNames.length > 0 && unboundNames.length <= 8) {
          console.log(`    Unbound tracks: ${unboundNames.join(', ')}`);
        } else if (unboundNames.length > 8) {
          console.log(`    Unbound tracks: ${unboundNames.slice(0, 5).join(', ')} ... +${unboundNames.length - 5} more`);
        }
      }

      const bindRate = totalBound + totalUnbound > 0 ? (totalBound / (totalBound + totalUnbound) * 100).toFixed(0) : '0';
      console.log(`%c[AVATAR] Track binding: ${totalBound}/${totalBound + totalUnbound} (${bindRate}%)`,
        totalBound === 0 ? 'color: #ff4444; font-weight: bold' : 'color: #00ff00; font-weight: bold');

      // Check if first clip is effectively static (all keyframes identical = baked T-pose)
      const firstClip = modelAnimations[0];
      const qTracks = firstClip.tracks.filter(t => t.name.endsWith('.quaternion'));
      let staticTracks = 0, checkedTracks = 0;
      const step = Math.max(1, Math.floor(qTracks.length / 20));
      for (let qi = 0; qi < qTracks.length; qi += step) {
        const v = qTracks[qi].values;
        if (v.length < 8) continue;
        checkedTracks++;
        const n = Math.floor(v.length / 4);
        const midIdx = Math.floor(n / 2) * 4;
        const diff = Math.abs(v[0] - v[midIdx]) + Math.abs(v[1] - v[midIdx + 1]) + Math.abs(v[2] - v[midIdx + 2]) + Math.abs(v[3] - v[midIdx + 3]);
        if (diff < 0.005) staticTracks++;
      }
      const isEffectivelyStatic = checkedTracks > 0 && staticTracks === checkedTracks;
      console.log(`  Static check: ${staticTracks}/${checkedTracks} sampled tracks are static → ${isEffectivelyStatic ? 'STATIC (T-pose baked)' : 'ANIMATED'}`);

      // Only use mixer if tracks bind AND animation has actual movement
      if (totalBound > 0 && !isEffectivelyStatic) {
        const mixer = new THREE.AnimationMixer(scene);
        mixerRef.current = mixer;
        hasClipAnimRef.current = true;

        const clipMap = categorizeClips(modelAnimations);
        clipMapRef.current = clipMap;

        const idleClip = clipMap.get('idle') || modelAnimations[0];
        const action = mixer.clipAction(idleClip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        currentActionRef.current = action;
        console.log(`%c[AVATAR] Playing clip: "${idleClip.name}"`, 'color: #00ff00; font-weight: bold');
      } else {
        const reason = isEffectivelyStatic ? 'Clips are static (T-pose baked)' : `All ${totalUnbound} tracks unbound`;
        console.log(`%c[AVATAR] ⚠ ${reason} — using procedural animation.`, 'color: #ff4444; font-weight: bold');
        hasClipAnimRef.current = false;
      }
    } else {
      console.log(`%c[AVATAR] No model clips — using procedural animation`, 'color: #ffa500; font-weight: bold');
    }

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current.uncacheRoot(scene);
        mixerRef.current = null;
      }
    };
  }, [scene, modelAnimations]);

  // =========================================================
  // EFFECT 3: Crossfade on animationState changes
  // =========================================================
  useEffect(() => {
    if (!mixerRef.current || clipMapRef.current.size === 0) return;
    if (animationState === currentAnimStateRef.current) return;
    const targetClip = clipMapRef.current.get(animationState);
    if (!targetClip) return;

    const mixer = mixerRef.current;
    const prevAction = currentActionRef.current;
    const nextAction = mixer.clipAction(targetClip);

    if (animationState === 'greeting') {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    nextAction.reset();
    if (prevAction) nextAction.crossFadeFrom(prevAction, CROSSFADE_DURATION, true);
    nextAction.play();
    currentActionRef.current = nextAction;
    currentAnimStateRef.current = animationState;

    if (animationState === 'greeting') {
      const onDone = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== nextAction) return;
        mixer.removeEventListener('finished', onDone);
        const idleClip = clipMapRef.current.get('idle');
        if (idleClip) {
          const a = mixer.clipAction(idleClip);
          a.reset();
          a.setLoop(THREE.LoopRepeat, Infinity);
          a.crossFadeFrom(nextAction, CROSSFADE_DURATION, true);
          a.play();
          currentActionRef.current = a;
          currentAnimStateRef.current = 'idle';
        }
      };
      mixer.addEventListener('finished', onDone);
    }
  }, [animationState]);

  // =========================================================
  // EFFECT 4: Synthetic mouth (fallback for no mouth rig)
  // =========================================================
  useEffect(() => {
    if (mouthMeshRef.current) { mouthMeshRef.current.removeFromParent(); mouthMeshRef.current = null; }
    if (hasFullMouthRigRef.current || !headBoneRef.current) return;

    const ws = new THREE.Vector3();
    headBoneRef.current.getWorldScale(ws);
    const avgS = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3;
    const sz = Math.max(avgS * 0.04, 0.008);

    const m = new THREE.Mesh(mouthGeo, mouthMat);
    m.name = 'SyntheticMouth';
    m.scale.set(sz, sz * 0.1, sz);
    m.position.set(0, -avgS * 0.04, avgS * 0.07);
    m.renderOrder = 1;

    headBoneRef.current.add(m);
    mouthMeshRef.current = m;

    return () => {
      if (mouthMeshRef.current) { mouthMeshRef.current.removeFromParent(); mouthMeshRef.current = null; }
      mouthGeo.dispose(); mouthMat.dispose();
    };
  }, [scene, mouthGeo, mouthMat]);

  // =========================================================
  // RENDER LOOP — smooth, layered animation
  // =========================================================
  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const vol = smoothVolRef.current;
    diagFrameRef.current++;

    // =======================================
    // SKELETON INIT — find SkinnedMesh and use its skeleton.bones DIRECTLY
    // This bypasses any reference mismatch between scene.getObjectByName
    // and the actual bones the GPU skinning shader uses
    // =======================================
    if (!skinnedMeshRef.current && scene) {
      scene.traverse((c: THREE.Object3D) => {
        if ((c as THREE.SkinnedMesh).isSkinnedMesh && !skinnedMeshRef.current) {
          skinnedMeshRef.current = c as THREE.SkinnedMesh;
        }
      });

      if (skinnedMeshRef.current) {
        const skel = skinnedMeshRef.current.skeleton;
        const bonesMap = new Map<string, THREE.Bone>();
        for (const bone of skel.bones) bonesMap.set(bone.name, bone);
        skelBonesMapRef.current = bonesMap;

        // Use skeleton bones (guaranteed to be what the shader uses)
        const sArmL = bonesMap.get('L_Upperarm') ?? null;
        const sArmR = bonesMap.get('R_Upperarm') ?? null;
        const sForeL = bonesMap.get('L_Forearm') ?? null;
        const sForeR = bonesMap.get('R_Forearm') ?? null;

        // Check if scene bones match skeleton bones
        const sceneArmL = scene.getObjectByName('L_Upperarm');
        const sameRef = sArmL === sceneArmL;

        if (sArmL) { armLRef.current = sArmL; armLRestQ.current = sArmL.quaternion.clone(); }
        if (sArmR) { armRRef.current = sArmR; armRRestQ.current = sArmR.quaternion.clone(); }
        if (sForeL) { forearmLRef.current = sForeL; forearmLRestQ.current = sForeL.quaternion.clone(); }
        if (sForeR) { forearmRRef.current = sForeR; forearmRRestQ.current = sForeR.quaternion.clone(); }

        // Also re-map head/neck/jaw from skeleton bones
        const sHead = bonesMap.get('Head') ?? null;
        const sNeck = bonesMap.get('NeckTwist01') ?? null;
        const sJaw = bonesMap.get('jaw') ?? null;
        if (sHead) { headBoneRef.current = sHead; headBaseRotRef.current = null; }
        if (sNeck) { neckBoneRef.current = sNeck; neckBaseRotRef.current = null; }
        if (sJaw) jawBoneRef.current = sJaw;

        const hasWeights = !!(skinnedMeshRef.current.geometry?.attributes?.skinWeight);
        const hasIndices = !!(skinnedMeshRef.current.geometry?.attributes?.skinIndex);
        const hasBoneTex = !!skel.boneTexture;

        console.log(`%c[AVATAR-SKEL] Using skeleton.bones directly! sameRefAsScene=${sameRef}`, 'color: #00ff00; font-weight: bold; font-size: 14px');
        console.log(`  SkinnedMesh: "${skinnedMeshRef.current.name}" bones=${skel.bones.length} skinWeights=${hasWeights} skinIndices=${hasIndices} boneTexture=${hasBoneTex} bindMode=${skinnedMeshRef.current.bindMode}`);
        console.log(`  Arm bones from skeleton: L=${sArmL?.name ?? 'MISS'} R=${sArmR?.name ?? 'MISS'}`);
      } else {
        console.log(`%c[AVATAR-SKEL] ⚠ NO SkinnedMesh found!`, 'color: #ff0000; font-weight: bold; font-size: 14px');
      }
    }

    // =======================================
    // GROUP-LEVEL ANIMATION (never distorts mesh)
    // This provides visible idle motion for ALL models.
    // Amplitude is larger when clips aren't animating the body.
    // =======================================
    if (groupRef.current) {
      // Stronger motion when no clip animation is active
      const amp = hasClipAnimRef.current ? 1.0 : 2.5;
      // Gentle breathing bob
      const breathY = Math.sin(t * 1.8) * 0.015 * amp;
      // Subtle weight shift (torso lean)
      const swayX = Math.sin(t * 0.6) * 0.012 * amp;
      // Looking around slowly
      const lookY = Math.sin(t * 0.35) * 0.04 * amp;
      // Slight lateral sway (weight shift side-to-side)
      const lateralX = Math.sin(t * 0.45) * 0.008 * amp;

      groupRef.current.position.y = -1 + breathY;
      groupRef.current.position.x = lateralX;
      groupRef.current.rotation.x = swayX;
      groupRef.current.rotation.y = lookY;
    }

    // =======================================
    // CLIP ANIMATION (if model has own clips)
    // =======================================
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // =======================================
    // T-POSE ARM FIX — applied AFTER mixer so we override T-pose
    // Uses skeleton.bones directly + forced matrix update
    // =======================================
    if (armLRef.current && armLRestQ.current) {
      armLRef.current.quaternion.copy(armLRestQ.current).multiply(armFixL);
      armLRef.current.updateMatrix();
    }
    if (armRRef.current && armRRestQ.current) {
      armRRef.current.quaternion.copy(armRRestQ.current).multiply(armFixR);
      armRRef.current.updateMatrix();
    }
    if (forearmLRef.current && forearmLRestQ.current) {
      forearmLRef.current.quaternion.copy(forearmLRestQ.current).multiply(forearmFixL);
      forearmLRef.current.updateMatrix();
    }
    if (forearmRRef.current && forearmRRestQ.current) {
      forearmRRef.current.quaternion.copy(forearmRRestQ.current).multiply(forearmFixR);
      forearmRRef.current.updateMatrix();
    }

    // =======================================
    // HEAD/NECK ANIMATION (bone-level, LARGE amplitude)
    // =======================================
    if (neckBoneRef.current) {
      if (!neckBaseRotRef.current) neckBaseRotRef.current = neckBoneRef.current.rotation.clone();
      neckBoneRef.current.rotation.y = neckBaseRotRef.current.y + Math.sin(t * 0.7) * 0.15;
      neckBoneRef.current.rotation.x = neckBaseRotRef.current.x + Math.sin(t * 1.0) * 0.08;
      neckBoneRef.current.updateMatrix();
    }
    if (headBoneRef.current) {
      if (!headBaseRotRef.current) headBaseRotRef.current = headBoneRef.current.rotation.clone();
      headBoneRef.current.rotation.z = headBaseRotRef.current.z + Math.sin(t * 1.3) * 0.12;
      headBoneRef.current.rotation.x = headBaseRotRef.current.x + Math.sin(t * 0.8) * 0.06;
      headBoneRef.current.updateMatrix();
    }

    // Force skeleton to recompute bone matrices for the GPU
    if (skinnedMeshRef.current?.skeleton) {
      const skel = skinnedMeshRef.current.skeleton;
      skel.update();
      if (skel.boneTexture) skel.boneTexture.needsUpdate = true;
    }

    // =======================================
    // DIAGNOSTIC LOGGING (sampled, ~every 3 sec)
    // =======================================
    if (diagFrameRef.current % 180 === 1) {
      const la = armLRef.current;
      const laQ = la ? `z=${la.quaternion.z.toFixed(3)} w=${la.quaternion.w.toFixed(3)}` : 'null';
      // Also log first few boneMatrix values to verify they change
      const skel = skinnedMeshRef.current?.skeleton;
      const bm = skel?.boneMatrices;
      const bmSample = bm ? `bm[0-3]=${bm[0].toFixed(2)},${bm[1].toFixed(2)},${bm[2].toFixed(2)},${bm[3].toFixed(2)}` : 'no-bm';
      console.log(`[AVATAR] f=${diagFrameRef.current} vol=${vol.toFixed(3)} jaw=${smoothJawRef.current.toFixed(3)} armL.q(${laQ}) ${bmSample}`);
    }

    // =======================================
    // FREQUENCY-DRIVEN LIP SYNC
    // =======================================
    const viseme = volumeRef.current;
    const jawAlpha = viseme.jawOpen > smoothJawRef.current ? 0.5 : 0.12;
    smoothJawRef.current += (viseme.jawOpen - smoothJawRef.current) * jawAlpha;
    const widthAlpha = viseme.mouthWidth > smoothWidthRef.current ? 0.4 : 0.15;
    smoothWidthRef.current += (viseme.mouthWidth - smoothWidthRef.current) * widthAlpha;
    const volAlpha = viseme.volume > smoothVolRef.current ? 0.45 : 0.1;
    smoothVolRef.current += (viseme.volume - smoothVolRef.current) * volAlpha;

    const jaw = smoothJawRef.current;
    const width = smoothWidthRef.current;

    // Jaw bone
    if (jawBoneRef.current) {
      const amp = hasFullMouthRigRef.current ? 0.45 : 0.35;
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(jawBoneRef.current.rotation.x, jaw * amp, 0.4);
    }

    // Full mouth rig lips
    if (hasFullMouthRigRef.current) {
      if (lipsLRef.current && !lipsLBaseRotRef.current) lipsLBaseRotRef.current = lipsLRef.current.rotation.clone();
      if (lipsRRef.current && !lipsRBaseRotRef.current) lipsRBaseRotRef.current = lipsRRef.current.rotation.clone();

      if (vol > 0.02) {
        // Active speech
        if (lipsLRef.current && lipsLBaseRotRef.current) {
          lipsLRef.current.rotation.y = THREE.MathUtils.lerp(lipsLRef.current.rotation.y, lipsLBaseRotRef.current.y - width * 0.12, 0.35);
          lipsLRef.current.rotation.z = THREE.MathUtils.lerp(lipsLRef.current.rotation.z, lipsLBaseRotRef.current.z + jaw * 0.06, 0.3);
        }
        if (lipsRRef.current && lipsRBaseRotRef.current) {
          lipsRRef.current.rotation.y = THREE.MathUtils.lerp(lipsRRef.current.rotation.y, lipsRBaseRotRef.current.y + width * 0.12, 0.35);
          lipsRRef.current.rotation.z = THREE.MathUtils.lerp(lipsRRef.current.rotation.z, lipsRBaseRotRef.current.z + jaw * 0.06, 0.3);
        }
        if (lipTopRef.current) lipTopRef.current.position.y = THREE.MathUtils.lerp(lipTopRef.current.position.y, jaw * 0.002, 0.3);
        if (lipBottomRef.current) lipBottomRef.current.position.y = THREE.MathUtils.lerp(lipBottomRef.current.position.y, -jaw * 0.001, 0.3);
        const cs = (width - 0.3) * 0.003;
        if (lipTopLRef.current) lipTopLRef.current.position.x = THREE.MathUtils.lerp(lipTopLRef.current.position.x, cs * 0.5, 0.2);
        if (lipTopRRef.current) lipTopRRef.current.position.x = THREE.MathUtils.lerp(lipTopRRef.current.position.x, -cs * 0.5, 0.2);
        if (lipBottomLRef.current) lipBottomLRef.current.position.x = THREE.MathUtils.lerp(lipBottomLRef.current.position.x, cs * 0.5, 0.2);
        if (lipBottomRRef.current) lipBottomRRef.current.position.x = THREE.MathUtils.lerp(lipBottomRRef.current.position.x, -cs * 0.5, 0.2);
      } else {
        // Idle breathing mouth
        const bp = Math.sin(t * 1.8) * 0.5 + 0.5;
        if (jawBoneRef.current) jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(jawBoneRef.current.rotation.x, bp * 0.01, 0.06);
        if (lipsLRef.current && lipsLBaseRotRef.current) lipsLRef.current.rotation.y = THREE.MathUtils.lerp(lipsLRef.current.rotation.y, lipsLBaseRotRef.current.y + bp * 0.005, 0.05);
        if (lipsRRef.current && lipsRBaseRotRef.current) lipsRRef.current.rotation.y = THREE.MathUtils.lerp(lipsRRef.current.rotation.y, lipsRBaseRotRef.current.y - bp * 0.005, 0.05);
      }
    }

    // Speech head gestures
    if (headBoneRef.current && headBaseRotRef.current && vol > 0.05) {
      headBoneRef.current.rotation.x += jaw * 0.012;
      headBoneRef.current.rotation.z += Math.sin(t * 6) * jaw * 0.006;
    }

    // Synthetic mouth overlay
    if (mouthMeshRef.current && !hasFullMouthRigRef.current) {
      const base = mouthMeshRef.current.userData.baseSize || mouthMeshRef.current.scale.x;
      if (!mouthMeshRef.current.userData.baseSize) mouthMeshRef.current.userData.baseSize = base;

      if (vol > 0.02) {
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, base * (0.15 + jaw * 2.0), 0.5);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, base * (0.7 + width * 0.8 + jaw * 0.2), 0.4);
        mouthMeshRef.current.scale.z = THREE.MathUtils.lerp(mouthMeshRef.current.scale.z, base * (0.7 + jaw * 0.5 - width * 0.15), 0.35);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.92, 0.3);
      } else {
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, base * 0.05, 0.08);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, base * 0.7, 0.08);
        mouthMeshRef.current.scale.z = THREE.MathUtils.lerp(mouthMeshRef.current.scale.z, base, 0.08);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.5, 0.04);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={scene} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}
