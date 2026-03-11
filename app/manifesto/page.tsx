'use client';

import { useRouter } from 'next/navigation';

export default function ManifestoPage() {
  const router = useRouter();

  return (
    <main className="relative min-h-screen overflow-y-auto"
          style={{ backgroundColor: '#050505', fontFamily: 'var(--font-primary)' }}>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-8 py-6 flex justify-between items-center"
           style={{ backgroundColor: 'rgba(5,5,5,0.9)', backdropFilter: 'blur(12px)' }}>
        <button
          onClick={() => router.push('/')}
          className="text-xs tracking-[0.2em] uppercase text-white/30 hover:text-[#d4af37]/60 transition-colors"
        >
          &larr; Return
        </button>
        <span className="text-xs tracking-[0.3em] uppercase text-white/20">
          LXXI Manifesto
        </span>
      </nav>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-8 pt-32 pb-24">

        {/* Title */}
        <h1 className="text-6xl md:text-7xl font-bold text-white mb-2"
            style={{ fontFamily: 'var(--font-heading)' }}>
          LXXI
        </h1>
        <p className="text-xs tracking-[0.3em] uppercase text-white/30 mb-16">
          Seventy-One
        </p>

        {/* Motto */}
        <blockquote className="text-2xl md:text-3xl text-[#d4af37] italic mb-16 leading-relaxed"
                    style={{ fontFamily: 'var(--font-heading)' }}>
          &ldquo;Voice is for Vibe,<br />
          Screen is for Substance.&rdquo;
        </blockquote>

        {/* Divider */}
        <div className="w-16 h-px bg-[#d4af37]/30 mb-16" />

        {/* Principles */}
        <div className="space-y-12 text-white/60 text-base leading-relaxed">

          <section>
            <h2 className="text-lg text-white/90 font-bold mb-3 tracking-wide uppercase"
                style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
              01 &mdash; Characters With Souls
            </h2>
            <p>
              Every agent in LXXI has an archetype, a history, and a voice that belongs to them alone.
              They are not waiting for commands. They are entities with opinions, memories, and a presence
              that grows through every session.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white/90 font-bold mb-3 tracking-wide uppercase"
                style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
              02 &mdash; Voice Carries Emotion
            </h2>
            <p>
              Real-time voice is the bridge between human intention and true understanding.
              Tone, rhythm, and feeling carry meaning that text alone cannot.
              The voice channel is where vibe lives.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white/90 font-bold mb-3 tracking-wide uppercase"
                style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
              03 &mdash; The Screen Delivers
            </h2>
            <p>
              While voice captures intent, the screen materializes it.
              3D avatars that breathe. Generated images that manifest from conversation.
              A spatial workspace of floating artifacts born from dialogue. The screen is where substance lives.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white/90 font-bold mb-3 tracking-wide uppercase"
                style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
              04 &mdash; Memory Makes Identity
            </h2>
            <p>
              An agent without memory is a stranger every time you meet.
              LXXI agents remember conversations, preferences, past work, and the stories you have built together.
              Memory is what transforms interaction into relationship.
            </p>
          </section>

          <section>
            <h2 className="text-lg text-white/90 font-bold mb-3 tracking-wide uppercase"
                style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
              V. &mdash; The Forge Never Closes
            </h2>
            <p>
              Creation is not a one-time event. Your partner evolves through every conversation,
              gains new memory, and generates new artifacts. Every session adds another layer.
              The forge is always open.
            </p>
          </section>

        </div>

        {/* Bottom divider */}
        <div className="w-16 h-px bg-[#d4af37]/30 mt-16 mb-8" />

        <p className="text-xs text-white/20 tracking-[0.2em] uppercase">
          Built with Voice, Vision, and Conviction.
        </p>

      </div>

      {/* Bottom decorative line */}
      <div className="fixed bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
    </main>
  );
}
