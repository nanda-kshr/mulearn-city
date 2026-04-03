import type { CityChunkPayload, CityResident } from "./city-types";

type InterestGroup = {
  id: string;
  name: string;
};

type Organization = {
  id: string;
  title: string;
  code: string;
  org_type: string;
};

type UserSearchItem = {
  full_name: string;
  muid: string;
  interest_groups: InterestGroup[];
  organizations: Organization[];
  profile_pic: string | null;
  karma: string;
};

type UserSearchResponse = {
  hasError: boolean;
  response?: {
    data?: UserSearchItem[];
    pagination?: {
      totalPages?: number;
    };
  };
};

type ActivityLog = {
  task_name: string;
  karma: number;
  created_date: string;
};

type UserLogResponse = {
  hasError: boolean;
  response?: ActivityLog[];
};

type ActivitySummary = {
  totalEvents: number;
  recentEvents: number;
  recentKarma: number;
  latestTask: string;
  lastActiveLabel: string;
};

type FetchCityPageOptions = {
  perPage?: number;
  userLimit?: number;
  recentDays?: number;
  includeLogs?: boolean;
  cache?: RequestCache;
};

type FetchCityResidentOptions = {
  recentDays?: number;
  perPage?: number;
  cache?: RequestCache;
};

export const CITY_USERS_API =
  process.env.CITY_USERS_API ??
  "https://mulearn.org/api/v1/dashboard/user/search/";
export const CITY_LOG_API_BASE =
  process.env.CITY_LOG_API_BASE ??
  "https://mulearn.org/api/v1/dashboard/profile/user-log";

export const CITY_PER_PAGE = readInt(process.env.CITY_PER_PAGE, 100, 1, 100);
export const CITY_USER_LIMIT = readInt(process.env.CITY_USER_LIMIT, 100, 1, 100);
export const CITY_RECENT_DAYS = readInt(process.env.CITY_RECENT_DAYS, 30, 1, 365);
export const CITY_LOAD_DISTANCE = readInt(process.env.CITY_LOAD_DISTANCE, 1, 1, 4);
export const CITY_CHUNK_SIZE = readInt(process.env.CITY_CHUNK_SIZE, 44, 24, 120);

const KARMA_FORMATTER = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});
const DATE_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function readInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function toKarma(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function normalizeName(fullName: string, muid: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  return muid
    .split("@")[0]
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function getInitials(name: string): string {
  const parts = name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "ML";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function hashHue(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash % 360);
}

function pickOrganization(organizations: Organization[]): string {
  const options = Array.from(
    new Set(
      organizations
        .map((organization) => organization.title.trim())
        .filter(Boolean),
    ),
  );

  return options[0] ?? "Independent";
}

function pickInterest(interestGroups: InterestGroup[]): string {
  const first = interestGroups
    .map((interestGroup) => interestGroup.name.trim())
    .find(Boolean);

  return first ?? "General";
}

function parseDate(value: string): Date | null {
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    return null;
  }

  return new Date(epoch);
}

function summarizeActivity(logs: ActivityLog[], recentDays: number): ActivitySummary {
  const threshold = Date.now() - recentDays * 24 * 60 * 60 * 1000;
  const latestTask = logs[0]?.task_name ?? "No tasks yet";
  let recentEvents = 0;
  let recentKarma = 0;
  let lastActive: Date | null = null;

  for (const log of logs) {
    const activityDate = parseDate(log.created_date);
    if (!activityDate) {
      continue;
    }

    if (!lastActive || activityDate > lastActive) {
      lastActive = activityDate;
    }

    if (activityDate.getTime() >= threshold) {
      recentEvents += 1;
      recentKarma += toKarma(log.karma);
    }
  }

  return {
    totalEvents: logs.length,
    recentEvents,
    recentKarma,
    latestTask,
    lastActiveLabel: lastActive ? DATE_FORMATTER.format(lastActive) : "No activity",
  };
}

async function fetchJson<T>(url: string, cacheMode: RequestCache): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: cacheMode,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchUsersPage(
  pageIndex: number,
  perPage: number,
  cacheMode: RequestCache,
  searchQuery = "",
): Promise<{ users: UserSearchItem[]; totalPages: number }> {
  const searchParams = new URLSearchParams({
    search: searchQuery,
    role: "",
    pageIndex: String(pageIndex),
    perPage: String(perPage),
  });

  const payload = await fetchJson<UserSearchResponse>(
    `${CITY_USERS_API}?${searchParams.toString()}`,
    cacheMode,
  );

  if (!payload || payload.hasError) {
    return {
      users: [],
      totalPages: 0,
    };
  }

  return {
    users: payload.response?.data ?? [],
    totalPages: Math.max(
      pageIndex,
      payload.response?.pagination?.totalPages ?? pageIndex,
    ),
  };
}

async function fetchLogs(muid: string, cacheMode: RequestCache): Promise<ActivityLog[]> {
  const payload = await fetchJson<UserLogResponse>(
    `${CITY_LOG_API_BASE}/${encodeURIComponent(muid)}/`,
    cacheMode,
  );

  if (!payload || payload.hasError) {
    return [];
  }

  return Array.isArray(payload.response) ? payload.response : [];
}

function buildResidents(
  users: UserSearchItem[],
  logsByMuid: Map<string, ActivityLog[]>,
  recentDays: number,
): CityResident[] {
  if (users.length === 0) {
    return [];
  }

  const karmaValues = users.map((user) => toKarma(user.karma));
  const minKarma = Math.min(...karmaValues);
  const maxKarma = Math.max(...karmaValues);
  const spread = Math.max(1, maxKarma - minKarma);

  return users.map((user) => {
    const karma = toKarma(user.karma);
    const normalized = (karma - minKarma) / spread;
    const activity = summarizeActivity(logsByMuid.get(user.muid) ?? [], recentDays);
    const organization = pickOrganization(user.organizations);
    const interest = pickInterest(user.interest_groups);
    const baseHue = hashHue(`${user.muid}:${interest}:${organization}`);
    const glow = Math.min(
      100,
      activity.recentEvents * 14 + Math.log10(activity.recentKarma + 1) * 34,
    );
    const name = normalizeName(user.full_name, user.muid);

    return {
      muid: user.muid,
      name,
      initials: getInitials(name),
      organization,
      interest,
      karma,
      karmaLabel: KARMA_FORMATTER.format(karma),
      totalEvents: activity.totalEvents,
      recentEvents: activity.recentEvents,
      recentKarma: activity.recentKarma,
      lastActiveLabel: activity.lastActiveLabel,
      latestTask: activity.latestTask,
      buildingHeight: 30 + normalized * 70,
      glow: activity.totalEvents > 0 ? Math.max(12, glow) : 8,
      hue: baseHue,
    };
  });
}

export async function fetchCityPage(
  pageIndex: number,
  options: FetchCityPageOptions = {},
): Promise<CityChunkPayload> {
  const resolvedPageIndex = Math.max(1, Math.floor(pageIndex));
  const perPage = readInt(
    options.perPage ? String(options.perPage) : undefined,
    CITY_PER_PAGE,
    1,
    100,
  );
  const userLimit = readInt(
    options.userLimit ? String(options.userLimit) : undefined,
    CITY_USER_LIMIT,
    1,
    perPage,
  );
  const recentDays = readInt(
    options.recentDays ? String(options.recentDays) : undefined,
    CITY_RECENT_DAYS,
    1,
    365,
  );
  const cacheMode = options.cache ?? "no-store";
  const includeLogs = options.includeLogs ?? true;

  const { users, totalPages } = await fetchUsersPage(
    resolvedPageIndex,
    perPage,
    cacheMode,
  );
  if (users.length === 0) {
    return {
      pageIndex: resolvedPageIndex,
      totalPages,
      residents: [],
    };
  }

  const rankedUsers = [...users]
    .sort((left, right) => toKarma(right.karma) - toKarma(left.karma))
    .slice(0, userLimit);

  const logEntries = includeLogs
    ? await Promise.all(
        rankedUsers.map(
          async (user) => [user.muid, await fetchLogs(user.muid, cacheMode)] as const,
        ),
      )
    : ([] as ReadonlyArray<readonly [string, ActivityLog[]]>);

  return {
    pageIndex: resolvedPageIndex,
    totalPages,
    residents: buildResidents(rankedUsers, new Map(logEntries), recentDays),
  };
}

export async function fetchCityResidentByMuid(
  muid: string,
  options: FetchCityResidentOptions = {},
): Promise<CityResident | null> {
  const query = muid.trim();
  if (query.length === 0) {
    return null;
  }

  const recentDays = readInt(
    options.recentDays ? String(options.recentDays) : undefined,
    CITY_RECENT_DAYS,
    1,
    365,
  );
  const perPage = readInt(
    options.perPage ? String(options.perPage) : undefined,
    25,
    1,
    100,
  );
  const cacheMode = options.cache ?? "no-store";

  const { users } = await fetchUsersPage(1, perPage, cacheMode, query);
  if (users.length === 0) {
    return null;
  }

  const queryLower = query.toLowerCase();
  const matchedUser =
    users.find((user) => user.muid.toLowerCase() === queryLower) ?? users[0];
  if (!matchedUser) {
    return null;
  }

  const logs = await fetchLogs(matchedUser.muid, cacheMode);
  const resident = buildResidents(
    [matchedUser],
    new Map([[matchedUser.muid, logs]]),
    recentDays,
  )[0];

  if (!resident) {
    return null;
  }

  const absoluteScale = Math.min(1, Math.log10(resident.karma + 1) / 5);
  return {
    ...resident,
    buildingHeight: 30 + absoluteScale * 70,
  };
}
