export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;

  // Secrets
  DASHBOARD_ACCESS_KEY: string;
  GEMINI_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  SPREADSHEET_ID: string;
  DRIVE_FOLDER_ID: string;
  FAMILY_CALENDAR_ID?: string;
  HOUSEHOLD_CALENDAR_ID?: string;
  INTERNAL_API_SECRET?: string;

  // Vars
  JAPAN_HOLIDAY_CALENDAR_ID: string;
  DEFAULT_HOUSEHOLD_CALENDAR_ID: string;
  HOME_LATITUDE: string;
  HOME_LONGITUDE: string;
  HOME_NAME: string;
  WORK_LATITUDE: string;
  WORK_LONGITUDE: string;
  WORK_NAME: string;
}

export type WorkMode = 'commute' | 'remote' | 'holiday';

export interface ActiveSession {
  id: string;
  title: string;
  sub: string;
  icon: string;
  mins: number;
  isAnchor: boolean;
  isSleepCard: boolean;
  isWorkBlock: boolean;
  isTriage: boolean;
  isCustom: boolean;
  linkedType: 'none' | 'task' | 'stock' | 'habit' | string;
  linkedId: string;
  cycleStampLabel: string;
  triageTaskIds: string[];
  startedAtMs: number;
  startedAtIso: string;
}

export interface DeckCard {
  id: string;
  title: string;
  sub: string;
  mins: number;
  icon: string;
  linkedType: string;
  linkedId: string;
  isTriage?: boolean;
  isAnchor?: boolean;
  isSleepCard?: boolean;
  isWorkBlock?: boolean;
  cycleStampLabel?: string;
  rightLabel?: string;
  triageTaskIds?: string[];
}

export interface DailyBriefing {
  dateKey: string;
  kicker: string;
  lines: string[];
  dismissed: boolean;
}

export interface TaskSnapshotItem {
  id: string;
  title: string;
  cleanTitle: string;
  cat: string;
  dueDate: string;
  status: string;
  done: boolean;
  memo: string;
  remindContext: string;
  docUrl: string;
  estimatedMins: number;
  rowIndex?: number;
}

export interface ShoppingSnapshotItem {
  id: string;
  rowIndex: number;
  item: string;
  category: string;
  status: string;
  done: boolean;
  createdAt: string;
}

export interface StockSnapshotItem {
  id: string;
  rowIndex: number;
  type: string;
  title: string;
  memo: string;
  status: string;
  done: boolean;
  consumedAt: string;
  estimatedMins: number;
}

export interface HabitSnapshotItem {
  id: string;
  label: string;
  date: string;
  elapsedDays: number | null;
  elapsed: string;
  stampedToday: boolean;
  estimatedMins: number;
}

export interface ListsSnapshot {
  updatedAt: string;
  tasks: TaskSnapshotItem[];
  shopping: ShoppingSnapshotItem[];
  stock: StockSnapshotItem[];
  habits: HabitSnapshotItem[];
}

export interface FastState {
  dayKey: string;
  revision: number;
  activeSession: ActiveSession | null;
  completedToday: Record<string, string | boolean>;
  dismissedToday: Record<string, string | boolean>;
  isLowMode: boolean;
  triagedToday: boolean;
  lastAction: {
    title: string;
    completedAt: string;
    isSleep: boolean;
  } | null;
  weatherFetchedAt: string;
  dailyBriefing: DailyBriefing | null;
  aiDeck: {
    generatedAt: string;
    cards: DeckCard[];
    lowCards: DeckCard[];
  };
  listCache: ListsSnapshot;
}

export interface HeroBoundary {
  label: string;
  targetMs: number | null;
  textOnly: string;
}

export interface BoundaryInfo {
  isDuringEvent: boolean;
  currentEventTitle: string;
  currentEventRemainingMinutes: number;
  minutesUntilNext: number;
  summaryText: string;
}

export interface WorkBoundaryResult {
  workMode: WorkMode;
  isHoliday: boolean;
  todayEvents: string[];
  boundaryInfo: BoundaryInfo;
  heroBoundary: HeroBoundary;
}

export type MemoryMap = Record<string, string>;

export interface LogEntry {
  id?: number;
  timestampStr: string;
  sender: string;
  message: string;
  imageUrl: string;
  aiReply: string;
  metaJson?: string;
}
