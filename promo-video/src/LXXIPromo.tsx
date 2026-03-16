import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  AbsoluteFill,
  Img,
  staticFile,
  Easing,
} from "remotion";
import {
  TransitionSeries,
  linearTiming,
} from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const { fontFamily: playfair } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin"],
});
const { fontFamily: inter } = loadInter("normal", {
  weights: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
});

// ============================================================
// BRAND CONSTANTS
// ============================================================
const GOLD = "#d4af37";
const GOLD_DIM = "rgba(212,175,55,0.3)";
const BG = "#050505";
const CYAN = "#22d3ee";

// ============================================================
// REUSABLE COMPONENTS
// ============================================================

const GoldLine = ({ frame, delay = 0 }: { frame: number; delay?: number }) => {
  const width = interpolate(frame - delay, [0, 20], [0, 120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  return (
    <div
      style={{
        width,
        height: 2,
        background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
        margin: "0 auto",
      }}
    />
  );
};

const FadeSlideIn = ({
  children,
  frame,
  delay = 0,
  direction = "up",
}: {
  children: React.ReactNode;
  frame: number;
  delay?: number;
  direction?: "up" | "down" | "left" | "right";
}) => {
  const progress = interpolate(frame - delay, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const dist = 40;
  const offsets = {
    up: `translateY(${(1 - progress) * dist}px)`,
    down: `translateY(${(1 - progress) * -dist}px)`,
    left: `translateX(${(1 - progress) * dist}px)`,
    right: `translateX(${(1 - progress) * -dist}px)`,
  };
  return (
    <div style={{ opacity: progress, transform: offsets[direction] }}>
      {children}
    </div>
  );
};

const Typewriter = ({
  text,
  frame,
  delay = 0,
  speed = 2,
  style,
}: {
  text: string;
  frame: number;
  delay?: number;
  speed?: number;
  style?: React.CSSProperties;
}) => {
  const chars = Math.floor(Math.max(0, frame - delay) / speed);
  const visible = text.slice(0, chars);
  const showCursor = chars < text.length;
  return (
    <span style={style}>
      {visible}
      {showCursor && (
        <span style={{ color: GOLD, opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0 }}>
          |
        </span>
      )}
    </span>
  );
};

const GlassCard = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <div
    style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 20,
      padding: 36,
      backdropFilter: "blur(12px)",
      ...style,
    }}
  >
    {children}
  </div>
);

// Floating gold particles background
const Particles = ({ frame }: { frame: number }) => {
  const particles = Array.from({ length: 30 }, (_, i) => {
    const x = ((i * 137.5 + frame * 0.15 * (i % 3 + 1)) % 1920);
    const y = ((i * 89.3 + frame * 0.1 * (i % 2 + 1)) % 1080);
    const r = (i % 4) * 0.5 + 1;
    const alpha = 0.08 + (i % 5) * 0.04;
    return { x, y, r, alpha };
  });
  return (
    <>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            width: p.r * 2,
            height: p.r * 2,
            borderRadius: "50%",
            background: GOLD,
            opacity: p.alpha,
          }}
        />
      ))}
    </>
  );
};

// ============================================================
// SCENE 1 — COLD OPEN (0-90 frames = 3s)
// Fast dark flash, logo slam
// ============================================================
const ColdOpen = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 12, stiffness: 200 }, delay: 10 });
  const logoOpacity = interpolate(frame, [5, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const glowIntensity = interpolate(frame, [20, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center" }}>
      <Particles frame={frame} />
      <div style={{ textAlign: "center", transform: `scale(${logoScale})`, opacity: logoOpacity }}>
        <Img
          src={staticFile("assets/lxxi-logo.png")}
          style={{
            width: 350,
            filter: `drop-shadow(0 0 ${40 + glowIntensity * 40}px ${GOLD_DIM})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 2 — THE PROBLEM (150 frames = 5s)
// Quick-cut text reveals
// ============================================================
const TheProblem = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: BG,
        justifyContent: "center",
        alignItems: "center",
        padding: 200,
      }}
    >
      <Particles frame={frame} />
      <div style={{ textAlign: "center", maxWidth: 1000 }}>
        <FadeSlideIn frame={frame} delay={0}>
          <p style={{ fontFamily: inter, fontSize: 36, color: "#737373", fontWeight: 300, marginBottom: 30, lineHeight: 1.6 }}>
            Every AI tool resets to zero.
          </p>
        </FadeSlideIn>
        <FadeSlideIn frame={frame} delay={20}>
          <p style={{ fontFamily: inter, fontSize: 36, color: "#737373", fontWeight: 300, marginBottom: 30, lineHeight: 1.6 }}>
            No memory. No presence. No continuity.
          </p>
        </FadeSlideIn>
        <FadeSlideIn frame={frame} delay={50}>
          <GoldLine frame={frame} delay={50} />
        </FadeSlideIn>
        <FadeSlideIn frame={frame} delay={65}>
          <p
            style={{
              fontFamily: playfair,
              fontSize: 44,
              color: GOLD,
              fontStyle: "italic",
              marginTop: 40,
              lineHeight: 1.4,
            }}
          >
            "I didn't want a faster search engine.
            <br />I wanted a partner."
          </p>
        </FadeSlideIn>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 3 — LOGO + TAGLINE (120 frames = 4s)
// ============================================================
const TaglineReveal = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 200 }, delay: 5 });

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center" }}>
      <Particles frame={frame} />
      <div style={{ textAlign: "center" }}>
        <div style={{ transform: `scale(${logoScale})`, marginBottom: 50 }}>
          <Img
            src={staticFile("assets/lxxi-logo.png")}
            style={{ width: 260, filter: `drop-shadow(0 0 50px ${GOLD_DIM})` }}
          />
        </div>
        <Typewriter
          text="Voice is for Vibe. Screen is for Substance."
          frame={frame}
          delay={25}
          speed={2}
          style={{ fontFamily: playfair, fontSize: 34, color: GOLD }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 4 — THREE PILLARS (180 frames = 6s)
// Voice / Memory / Presence — slam in one by one
// ============================================================
const ThreePillars = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pillars = [
    { icon: "\u{1F5E3}\uFE0F", title: "Voice", desc: "Real-time conversation that carries emotion", delay: 10 },
    { icon: "\u{1F9E0}", title: "Memory", desc: "Agents that remember everything about you", delay: 35 },
    { icon: "\u{1F310}", title: "Presence", desc: "3D avatars that see you and build with you", delay: 60 },
  ];

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center" }}>
      <Particles frame={frame} />
      <div style={{ display: "flex", gap: 50 }}>
        {pillars.map((p, i) => {
          const scale = spring({ frame, fps, config: { damping: 15, stiffness: 200 }, delay: p.delay });
          return (
            <div key={i} style={{ transform: `scale(${scale})` }}>
              <GlassCard style={{ width: 340, textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 64, marginBottom: 20 }}>{p.icon}</div>
                <h3 style={{ fontFamily: playfair, fontSize: 36, color: "#fff", fontWeight: 700, marginBottom: 12 }}>
                  {p.title}
                </h3>
                <p style={{ fontFamily: inter, fontSize: 18, color: "#a3a3a3", lineHeight: 1.5 }}>
                  {p.desc}
                </p>
              </GlassCard>
            </div>
          );
        })}
      </div>
      <FadeSlideIn frame={frame} delay={90}>
        <p
          style={{
            fontFamily: playfair,
            fontSize: 28,
            color: GOLD,
            textAlign: "center",
            marginTop: 50,
          }}
        >
          Your Memory. Your Partner. Presence in Every Dimension.
        </p>
      </FadeSlideIn>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 5 — THE FORGE (240 frames = 8s)
// Describe > Upload > Create flow
// ============================================================
const TheForge = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const steps = [
    { num: "1", title: "DESCRIBE", desc: "Speak to The Architect.\nDefine who your partner is.", delay: 30 },
    { num: "2", title: "UPLOAD", desc: "Give them a face.\nGenerate a 3D avatar.", delay: 60 },
    { num: "3", title: "CREATE", desc: "Enter the workspace.\nYour partner builds with you.", delay: 90 },
  ];

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <Particles frame={frame} />
      <FadeSlideIn frame={frame} delay={0}>
        <p style={{ fontFamily: inter, fontSize: 16, letterSpacing: 8, color: GOLD, textTransform: "uppercase" as const, textAlign: "center" }}>
          Prime Mode
        </p>
      </FadeSlideIn>
      <FadeSlideIn frame={frame} delay={5}>
        <h2 style={{ fontFamily: playfair, fontSize: 72, color: "#fff", fontWeight: 800, textAlign: "center", margin: "10px 0 40px" }}>
          THE FORGE
        </h2>
      </FadeSlideIn>
      <div style={{ display: "flex", gap: 40 }}>
        {steps.map((s, i) => {
          const scale = spring({ frame, fps, config: { damping: 12, stiffness: 180 }, delay: s.delay });
          return (
            <div key={i} style={{ transform: `scale(${scale})` }}>
              <GlassCard style={{ width: 340, textAlign: "center" }}>
                <div style={{ fontFamily: playfair, fontSize: 64, color: GOLD, fontWeight: 800, marginBottom: 12 }}>
                  {s.num}
                </div>
                <h4 style={{ fontFamily: inter, fontSize: 22, color: "#fff", fontWeight: 600, letterSpacing: 3, marginBottom: 12 }}>
                  {s.title}
                </h4>
                <p style={{ fontFamily: inter, fontSize: 16, color: "#a3a3a3", lineHeight: 1.6, whiteSpace: "pre-line" }}>
                  {s.desc}
                </p>
              </GlassCard>
            </div>
          );
        })}
      </div>
      {/* Use cases */}
      <div style={{ marginTop: 50, maxWidth: 900 }}>
        {[
          { text: "A lawyer loads a judge's ruling history and argues their case out loud.", delay: 120 },
          { text: "A designer holds fabric to the camera and watches designs appear.", delay: 145 },
        ].map((uc, i) => (
          <FadeSlideIn key={i} frame={frame} delay={uc.delay} direction="left">
            <p
              style={{
                fontFamily: inter,
                fontSize: 20,
                color: "#a3a3a3",
                fontStyle: "italic",
                borderLeft: `2px solid ${GOLD}`,
                paddingLeft: 24,
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              {uc.text}
            </p>
          </FadeSlideIn>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 6 — WORKSPACE FEATURES (240 frames = 8s)
// Feature cards slam in with spring
// ============================================================
const WorkspaceFeatures = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const features = [
    { icon: "\u{1F399}\uFE0F", title: "Real-Time Voice", desc: "Sub-second Gemini 2.5 Flash streaming", delay: 15 },
    { icon: "\u{1F9D1}\u200D\u{1F3A4}", title: "3D Lip Sync", desc: "Bone-driven animation from audio", delay: 30 },
    { icon: "\u{1F5BC}\uFE0F", title: "Image Gen", desc: "Imagen 4 creates floating artifacts", delay: 45 },
    { icon: "\u{1F4C4}", title: "Documents", desc: "Code and text from dialogue", delay: 60 },
    { icon: "\u{1F4DA}", title: "Memory & RAG", desc: "Ingest PDFs, recall across sessions", delay: 75 },
    { icon: "\u2728", title: "SOULS Library", desc: "Browse and awaken your characters", delay: 90 },
  ];

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <Particles frame={frame} />
      <FadeSlideIn frame={frame} delay={0}>
        <p style={{ fontFamily: inter, fontSize: 16, letterSpacing: 8, color: GOLD, textTransform: "uppercase" as const, textAlign: "center" }}>
          Spatial Environment
        </p>
      </FadeSlideIn>
      <FadeSlideIn frame={frame} delay={5}>
        <h2 style={{ fontFamily: playfair, fontSize: 72, color: "#fff", fontWeight: 800, textAlign: "center", margin: "10px 0 40px" }}>
          THE WORKSPACE
        </h2>
      </FadeSlideIn>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, maxWidth: 1200 }}>
        {features.map((f, i) => {
          const scale = spring({ frame, fps, config: { damping: 15, stiffness: 200 }, delay: f.delay });
          return (
            <div key={i} style={{ transform: `scale(${scale})` }}>
              <GlassCard style={{ textAlign: "left" }}>
                <div style={{ fontSize: 36, marginBottom: 16 }}>{f.icon}</div>
                <h4 style={{ fontFamily: playfair, fontSize: 22, color: "#fff", fontWeight: 600, marginBottom: 8 }}>
                  {f.title}
                </h4>
                <p style={{ fontFamily: inter, fontSize: 15, color: "#a3a3a3", lineHeight: 1.5 }}>{f.desc}</p>
              </GlassCard>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 7 — LEO'S LEARNING LAB (210 frames = 7s)
// ============================================================
const LeosLab = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const features = [
    { title: "Voice-First Learning", desc: "Talk through problems with a real tutor", delay: 20 },
    { title: "Visual Chalkboard", desc: "Problems and hints appear live", delay: 40 },
    { title: "Adaptive Difficulty", desc: "Scales to the student's pace", delay: 60 },
    { title: "Persistent Profile", desc: "Remembers progress and friendship level", delay: 80 },
  ];

  const subjects = ["Math", "Spanish", "Science", "General Knowledge"];

  return (
    <AbsoluteFill style={{ background: "#0a0806", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <Particles frame={frame} />
      <FadeSlideIn frame={frame} delay={0}>
        <p style={{ fontFamily: inter, fontSize: 16, letterSpacing: 8, color: "#fbbf24", textTransform: "uppercase" as const, textAlign: "center" }}>
          Spark Mode
        </p>
      </FadeSlideIn>
      <FadeSlideIn frame={frame} delay={5}>
        <h2 style={{ fontFamily: playfair, fontSize: 64, color: "#fff", fontWeight: 800, textAlign: "center", margin: "10px 0 40px" }}>
          LEO'S LEARNING LAB
        </h2>
      </FadeSlideIn>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, maxWidth: 900 }}>
        {features.map((f, i) => {
          const scale = spring({ frame, fps, config: { damping: 15, stiffness: 200 }, delay: f.delay });
          return (
            <div key={i} style={{ transform: `scale(${scale})` }}>
              <GlassCard>
                <h4 style={{ fontFamily: playfair, fontSize: 22, color: "#fff", fontWeight: 600, marginBottom: 8 }}>
                  {f.title}
                </h4>
                <p style={{ fontFamily: inter, fontSize: 15, color: "#a3a3a3", lineHeight: 1.5 }}>{f.desc}</p>
              </GlassCard>
            </div>
          );
        })}
      </div>
      {/* Subject pills */}
      <div style={{ display: "flex", gap: 16, marginTop: 40 }}>
        {subjects.map((s, i) => {
          const scale = spring({ frame, fps, config: { damping: 15 }, delay: 100 + i * 10 });
          return (
            <div
              key={i}
              style={{
                transform: `scale(${scale})`,
                padding: "12px 30px",
                borderRadius: 999,
                background: "rgba(251,191,36,0.1)",
                border: "1px solid rgba(251,191,36,0.3)",
                color: "#fbbf24",
                fontFamily: inter,
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              {s}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 8 — THE MANIFESTO (270 frames = 9s)
// Five principles, one by one
// ============================================================
const Manifesto = () => {
  const frame = useCurrentFrame();

  const principles = [
    { num: "I", title: "Characters With Souls", desc: "Every agent has an archetype, a history, and a voice that belongs to them alone." },
    { num: "II", title: "Voice Carries Emotion", desc: "Tone, rhythm, and feeling carry meaning that text alone cannot." },
    { num: "III", title: "The Screen Delivers", desc: "3D avatars that breathe. Generated images that manifest from conversation." },
    { num: "IV", title: "Memory Makes Identity", desc: "An agent without memory is a stranger every time you meet." },
    { num: "V", title: "The Forge Never Closes", desc: "Every session adds another layer. Creation is not a one-time event." },
  ];

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center", flexDirection: "column", padding: "60px 200px" }}>
      <Particles frame={frame} />
      <FadeSlideIn frame={frame} delay={0}>
        <p style={{ fontFamily: inter, fontSize: 16, letterSpacing: 8, color: "#737373", textTransform: "uppercase" as const, textAlign: "center" }}>
          Built with Voice, Vision, and Conviction
        </p>
      </FadeSlideIn>
      <FadeSlideIn frame={frame} delay={10}>
        <GoldLine frame={frame} delay={10} />
      </FadeSlideIn>
      <div style={{ maxWidth: 800, width: "100%", marginTop: 30 }}>
        {principles.map((p, i) => (
          <FadeSlideIn key={i} frame={frame} delay={25 + i * 35}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 28,
                padding: "22px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <span style={{ fontFamily: playfair, fontSize: 36, color: GOLD, fontWeight: 700, minWidth: 70 }}>
                {p.num}.
              </span>
              <div>
                <h4 style={{ fontFamily: playfair, fontSize: 24, color: "#fff", fontWeight: 600, marginBottom: 6 }}>
                  {p.title}
                </h4>
                <p style={{ fontFamily: inter, fontSize: 17, color: "#a3a3a3", lineHeight: 1.5 }}>{p.desc}</p>
              </div>
            </div>
          </FadeSlideIn>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 9 — TECH STACK (180 frames = 6s)
// ============================================================
const TechStack = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const techs = [
    { name: "Gemini 2.5 Flash", sub: "Native Audio Streaming", delay: 15 },
    { name: "Imagen 4", sub: "Image Generation", delay: 25 },
    { name: "React Three Fiber", sub: "3D Avatar Rendering", delay: 35 },
    { name: "Firebase", sub: "Auth + Firestore + Functions", delay: 45 },
    { name: "Pinecone", sub: "Vector Memory (RAG)", delay: 55 },
    { name: "Tripo3D", sub: "Image-to-3D Pipeline", delay: 65 },
  ];

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <Particles frame={frame} />
      <FadeSlideIn frame={frame} delay={0}>
        <p style={{ fontFamily: inter, fontSize: 16, letterSpacing: 8, color: GOLD, textTransform: "uppercase" as const }}>
          Powered By
        </p>
      </FadeSlideIn>
      <FadeSlideIn frame={frame} delay={5}>
        <h2 style={{ fontFamily: playfair, fontSize: 56, color: "#fff", fontWeight: 800, textAlign: "center", margin: "10px 0 40px" }}>
          THE TECHNOLOGY
        </h2>
      </FadeSlideIn>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center", maxWidth: 900 }}>
        {techs.map((t, i) => {
          const scale = spring({ frame, fps, config: { damping: 20, stiffness: 200 }, delay: t.delay });
          return (
            <div
              key={i}
              style={{
                transform: `scale(${scale})`,
                padding: "18px 36px",
                borderRadius: 14,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: inter, fontSize: 18, color: "#fff", fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontFamily: inter, fontSize: 13, color: "#737373", marginTop: 4 }}>{t.sub}</div>
            </div>
          );
        })}
      </div>
      {/* Architecture diagram zoom-in */}
      <Sequence from={80} premountFor={30}>
        <FadeSlideIn frame={frame} delay={80}>
          <div style={{ marginTop: 30 }}>
            <Img
              src={staticFile("assets/architecture_diagram.png")}
              style={{
                maxWidth: 750,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
          </div>
        </FadeSlideIn>
      </Sequence>
    </AbsoluteFill>
  );
};

// ============================================================
// SCENE 10 — CLOSING / CTA (240 frames = 8s)
// "LXXI.com — Coming Soon" with gold particle explosion
// ============================================================
const Closing = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 200 }, delay: 10 });
  const glowPulse = Math.sin(frame * 0.08) * 0.3 + 0.7;

  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center" }}>
      <Particles frame={frame} />
      {/* Radial glow behind logo */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(212,175,55,${0.08 * glowPulse}) 0%, transparent 70%)`,
        }}
      />
      <div style={{ textAlign: "center", transform: `scale(${logoScale})` }}>
        <Img
          src={staticFile("assets/lxxi-logo.png")}
          style={{
            width: 300,
            filter: `drop-shadow(0 0 ${50 * glowPulse}px ${GOLD_DIM})`,
            marginBottom: 40,
          }}
        />
        <FadeSlideIn frame={frame} delay={40}>
          <Typewriter
            text="The Forge Never Closes."
            frame={frame}
            delay={50}
            speed={3}
            style={{
              fontFamily: playfair,
              fontSize: 42,
              color: GOLD,
              display: "block",
              marginBottom: 30,
            }}
          />
        </FadeSlideIn>
        <FadeSlideIn frame={frame} delay={120}>
          <GoldLine frame={frame} delay={120} />
        </FadeSlideIn>
        <FadeSlideIn frame={frame} delay={140}>
          <p
            style={{
              fontFamily: inter,
              fontSize: 28,
              color: "#fff",
              letterSpacing: 6,
              marginTop: 30,
              fontWeight: 300,
            }}
          >
            LXXI.com
          </p>
        </FadeSlideIn>
        <FadeSlideIn frame={frame} delay={160}>
          <p
            style={{
              fontFamily: inter,
              fontSize: 18,
              color: GOLD,
              letterSpacing: 10,
              marginTop: 16,
              textTransform: "uppercase" as const,
              fontWeight: 600,
            }}
          >
            Coming Soon
          </p>
        </FadeSlideIn>
      </div>
    </AbsoluteFill>
  );
};

// ============================================================
// MAIN COMPOSITION — All scenes stitched with transitions
// ============================================================
export const LXXIPromo = () => {
  return (
    <TransitionSeries>
      {/* 1. Cold Open — Logo slam */}
      <TransitionSeries.Sequence durationInFrames={90}>
        <ColdOpen />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />

      {/* 2. The Problem */}
      <TransitionSeries.Sequence durationInFrames={150}>
        <TheProblem />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />

      {/* 3. Tagline Reveal */}
      <TransitionSeries.Sequence durationInFrames={120}>
        <TaglineReveal />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={linearTiming({ durationInFrames: 20 })}
      />

      {/* 4. Three Pillars */}
      <TransitionSeries.Sequence durationInFrames={180}>
        <ThreePillars />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />

      {/* 5. The Forge */}
      <TransitionSeries.Sequence durationInFrames={240}>
        <TheForge />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: 20 })}
      />

      {/* 6. Workspace Features */}
      <TransitionSeries.Sequence durationInFrames={240}>
        <WorkspaceFeatures />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />

      {/* 7. Leo's Learning Lab */}
      <TransitionSeries.Sequence durationInFrames={210}>
        <LeosLab />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-left" })}
        timing={linearTiming({ durationInFrames: 20 })}
      />

      {/* 8. Manifesto */}
      <TransitionSeries.Sequence durationInFrames={270}>
        <Manifesto />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />

      {/* 9. Tech Stack */}
      <TransitionSeries.Sequence durationInFrames={180}>
        <TechStack />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 20 })}
      />

      {/* 10. Closing / CTA */}
      <TransitionSeries.Sequence durationInFrames={240}>
        <Closing />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
