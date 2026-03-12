/**
 * Learner Profile System
 *
 * Manages student identity, progress tracking, and session history
 * for Leo's Learning Lab. Persists to localStorage with optional
 * Firestore sync for logged-in users.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface LearnerProfile {
  id: string;
  name: string;
  createdAt: number;
  lastSessionAt: number;
  /** Total sessions completed */
  totalSessions: number;
  /** Per-subject progress */
  progress: SubjectProgress;
  /** Friendship level 0-100 (grows with interaction) */
  friendshipLevel: number;
  /** Preferences learned over time */
  preferences: LearnerPreferences;
}

export interface SubjectProgress {
  math: TopicProgress;
  spanish: TopicProgress;
  science: TopicProgress;
  general: TopicProgress;
}

export interface TopicProgress {
  /** Total problems attempted */
  attempted: number;
  /** Total correct answers */
  correct: number;
  /** Current difficulty level */
  currentDifficulty: 'easy' | 'medium' | 'hard';
  /** Specific topics mastered */
  masteredTopics: string[];
  /** Topics currently working on */
  currentTopics: string[];
  /** Last topic worked on */
  lastTopic: string;
  /** Streak of correct answers in a row */
  streak: number;
  /** Best streak ever */
  bestStreak: number;
}

export interface LearnerPreferences {
  favoriteSubject: string;
  /** Preferred encouragement style learned over time */
  encouragementStyle: 'enthusiastic' | 'calm' | 'funny';
  /** Topics they've expressed interest in */
  interests: string[];
}

// ─── Defaults ────────────────────────────────────────────────────

const DEFAULT_TOPIC_PROGRESS: TopicProgress = {
  attempted: 0,
  correct: 0,
  currentDifficulty: 'easy',
  masteredTopics: [],
  currentTopics: [],
  lastTopic: '',
  streak: 0,
  bestStreak: 0,
};

function createDefaultProfile(name: string): LearnerProfile {
  const now = Date.now();
  return {
    id: `learner_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    createdAt: now,
    lastSessionAt: now,
    totalSessions: 0,
    progress: {
      math: { ...DEFAULT_TOPIC_PROGRESS },
      spanish: { ...DEFAULT_TOPIC_PROGRESS },
      science: { ...DEFAULT_TOPIC_PROGRESS },
      general: { ...DEFAULT_TOPIC_PROGRESS },
    },
    friendshipLevel: 0,
    preferences: {
      favoriteSubject: '',
      encouragementStyle: 'enthusiastic',
      interests: [],
    },
  };
}

// ─── Storage Keys ────────────────────────────────────────────────

const STORAGE_KEY = 'lxxi_learner_profile';

// ─── CRUD Operations ─────────────────────────────────────────────

/** Load the learner profile from localStorage. Returns null if none exists. */
export function loadLearnerProfile(): LearnerProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LearnerProfile;
  } catch (e) {
    console.warn('[LEARNER] Failed to load profile:', e);
    return null;
  }
}

/** Save the learner profile to localStorage. */
export function saveLearnerProfile(profile: LearnerProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.warn('[LEARNER] Failed to save profile:', e);
  }
}

/** Create a new learner profile with the given name. */
export function createLearnerProfile(name: string): LearnerProfile {
  const profile = createDefaultProfile(name);
  saveLearnerProfile(profile);
  return profile;
}

/** Update specific fields on the profile. */
export function updateLearnerProfile(updates: Partial<LearnerProfile>): LearnerProfile | null {
  const profile = loadLearnerProfile();
  if (!profile) return null;
  const updated = { ...profile, ...updates };
  saveLearnerProfile(updated);
  return updated;
}

// ─── Session Tracking ────────────────────────────────────────────

/** Record that a new session has started. */
export function startLearnerSession(): LearnerProfile | null {
  const profile = loadLearnerProfile();
  if (!profile) return null;
  profile.totalSessions++;
  profile.lastSessionAt = Date.now();
  // Friendship grows with each session (diminishing returns)
  profile.friendshipLevel = Math.min(100, profile.friendshipLevel + Math.max(1, 5 - Math.floor(profile.friendshipLevel / 20)));
  saveLearnerProfile(profile);
  return profile;
}

/** Record a problem attempt for a subject. */
export function recordProblemAttempt(
  subject: keyof SubjectProgress,
  correct: boolean,
  topic: string = ''
): LearnerProfile | null {
  const profile = loadLearnerProfile();
  if (!profile) return null;

  const prog = profile.progress[subject];
  prog.attempted++;
  if (correct) {
    prog.correct++;
    prog.streak++;
    if (prog.streak > prog.bestStreak) prog.bestStreak = prog.streak;
    // Friendship boost for correct answers
    profile.friendshipLevel = Math.min(100, profile.friendshipLevel + 1);
  } else {
    prog.streak = 0;
  }

  if (topic) {
    prog.lastTopic = topic;
    if (!prog.currentTopics.includes(topic)) {
      prog.currentTopics.push(topic);
      // Keep only last 10 topics
      if (prog.currentTopics.length > 10) prog.currentTopics.shift();
    }
  }

  // Auto-adjust difficulty based on performance
  const recentAccuracy = prog.attempted > 0 ? prog.correct / prog.attempted : 0;
  if (prog.attempted >= 5 && prog.streak >= 3 && recentAccuracy > 0.8) {
    if (prog.currentDifficulty === 'easy') prog.currentDifficulty = 'medium';
    else if (prog.currentDifficulty === 'medium') prog.currentDifficulty = 'hard';
  }

  // Track mastered topics (3+ correct in same topic)
  if (correct && topic && prog.streak >= 3 && !prog.masteredTopics.includes(topic)) {
    prog.masteredTopics.push(topic);
  }

  saveLearnerProfile(profile);
  return profile;
}

// ─── Context Generation ──────────────────────────────────────────

/** Generate a context string for the AI about this learner. */
export function buildLearnerContext(profile: LearnerProfile): string {
  const lines: string[] = [];

  lines.push(`STUDENT PROFILE:`);
  lines.push(`- Name: ${profile.name}`);
  lines.push(`- Sessions completed: ${profile.totalSessions}`);
  lines.push(`- Friendship level: ${profile.friendshipLevel}/100`);

  if (profile.friendshipLevel >= 20) {
    lines.push(`- You and ${profile.name} are becoming friends! Use their name naturally in conversation.`);
  }
  if (profile.friendshipLevel >= 50) {
    lines.push(`- ${profile.name} trusts you! You can be more playful and challenge them a bit more.`);
  }
  if (profile.friendshipLevel >= 80) {
    lines.push(`- ${profile.name} is one of your best students! You have a strong bond. Be warm and reference past sessions.`);
  }

  // Per-subject progress
  for (const [subj, prog] of Object.entries(profile.progress)) {
    if (prog.attempted > 0) {
      const accuracy = Math.round((prog.correct / prog.attempted) * 100);
      lines.push(`\n${subj.toUpperCase()} PROGRESS:`);
      lines.push(`  - Problems: ${prog.correct}/${prog.attempted} correct (${accuracy}%)`);
      lines.push(`  - Current difficulty: ${prog.currentDifficulty}`);
      lines.push(`  - Current streak: ${prog.streak} (best: ${prog.bestStreak})`);
      if (prog.lastTopic) lines.push(`  - Last topic: ${prog.lastTopic}`);
      if (prog.masteredTopics.length > 0) lines.push(`  - Mastered: ${prog.masteredTopics.join(', ')}`);
      if (prog.currentTopics.length > 0) lines.push(`  - Working on: ${prog.currentTopics.slice(-3).join(', ')}`);
    }
  }

  if (profile.preferences.interests.length > 0) {
    lines.push(`\nINTERESTS: ${profile.preferences.interests.join(', ')}`);
  }

  lines.push(`\nIMPORTANT: Always address the student by name ("${profile.name}"). Use their name at least once every 2-3 exchanges. Say things like "Great job, ${profile.name}!" or "What do you think, ${profile.name}?"`);

  return lines.join('\n');
}
