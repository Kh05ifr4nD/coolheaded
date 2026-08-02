import { compare as compareSemvers, valid } from "semver";

type VersionSchemeName = "calendar" | "semver";

interface VersionScheme {
  readonly compare: (left: string, right: string) => number;
  readonly description: string;
  readonly isValid: (version: string) => boolean;
  readonly name: VersionSchemeName;
}

function canonicalSemver(version: string): string | null {
  const buildMetadataIndex = version.indexOf("+");
  const precedenceVersion =
    buildMetadataIndex === -1 ? version : version.slice(0, buildMetadataIndex);

  return valid(version) === precedenceVersion ? version : null;
}

function parseSemver(version: string): string {
  const parsed = canonicalSemver(version);
  if (parsed === null) {
    throw new TypeError(`Invalid SemVer: ${version}`);
  }

  return parsed;
}

function compareVersions(left: string, right: string): number {
  return compareSemvers(parseSemver(left), parseSemver(right));
}

function isSemver(version: string): boolean {
  return canonicalSemver(version) !== null;
}

const CALENDAR_FIRST_DAY = 1;
const CALENDAR_FIRST_MONTH_INDEX = 1;
const CALENDAR_FEBRUARY = 2;
const CALENDAR_LEAP_YEAR_DIVISOR = 4;
const CALENDAR_CENTURY_YEAR_DIVISOR = 100;
const CALENDAR_LEAP_YEAR_CYCLE = 400;
const CALENDAR_JANUARY_DAYS = 31;
const CALENDAR_COMMON_FEBRUARY_DAYS = 28;
const CALENDAR_LEAP_FEBRUARY_DAYS = 29;
const CALENDAR_MARCH_DAYS = 31;
const CALENDAR_APRIL_DAYS = 30;
const CALENDAR_MAY_DAYS = 31;
const CALENDAR_JUNE_DAYS = 30;
const CALENDAR_JULY_DAYS = 31;
const CALENDAR_AUGUST_DAYS = 31;
const CALENDAR_SEPTEMBER_DAYS = 30;
const CALENDAR_OCTOBER_DAYS = 31;
const CALENDAR_NOVEMBER_DAYS = 30;
const CALENDAR_DECEMBER_DAYS = 31;
const CALENDAR_MONTH_DAYS = [
  CALENDAR_JANUARY_DAYS,
  CALENDAR_COMMON_FEBRUARY_DAYS,
  CALENDAR_MARCH_DAYS,
  CALENDAR_APRIL_DAYS,
  CALENDAR_MAY_DAYS,
  CALENDAR_JUNE_DAYS,
  CALENDAR_JULY_DAYS,
  CALENDAR_AUGUST_DAYS,
  CALENDAR_SEPTEMBER_DAYS,
  CALENDAR_OCTOBER_DAYS,
  CALENDAR_NOVEMBER_DAYS,
  CALENDAR_DECEMBER_DAYS,
] as const;

function calendarVersionParts(version: string): readonly [number, number, number] | null {
  const match = /^(?<year>\d{4})\.(?<month>\d{2})\.(?<day>\d{2})$/u.exec(version);
  const yearText = match?.groups?.["year"];
  const monthText = match?.groups?.["month"];
  const dayText = match?.groups?.["day"];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return null;
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const isLeapYear =
    (year % CALENDAR_LEAP_YEAR_DIVISOR === 0 && year % CALENDAR_CENTURY_YEAR_DIVISOR !== 0) ||
    year % CALENDAR_LEAP_YEAR_CYCLE === 0;
  const daysInMonth =
    month === CALENDAR_FEBRUARY && isLeapYear
      ? CALENDAR_LEAP_FEBRUARY_DAYS
      : CALENDAR_MONTH_DAYS[month - CALENDAR_FIRST_MONTH_INDEX];
  return daysInMonth !== undefined && day >= CALENDAR_FIRST_DAY && day <= daysInMonth
    ? [year, month, day]
    : null;
}

function isCalendarVersion(version: string): boolean {
  return calendarVersionParts(version) !== null;
}

function compareCalendarVersions(left: string, right: string): number {
  const leftParts = calendarVersionParts(left);
  const rightParts = calendarVersionParts(right);
  if (leftParts === null || rightParts === null) {
    throw new TypeError(`Invalid calendar version: ${leftParts === null ? left : right}`);
  }

  const parts: readonly (readonly [number, number])[] = [
    [leftParts[0], rightParts[0]],
    [leftParts[1], rightParts[1]],
    [leftParts[2], rightParts[2]],
  ];
  for (const [leftPart, rightPart] of parts) {
    if (leftPart < rightPart) {
      return -1;
    }
    if (leftPart > rightPart) {
      return 1;
    }
  }
  return 0;
}

const semverVersionScheme: VersionScheme = {
  compare: compareVersions,
  description: "SemVer",
  isValid: isSemver,
  name: "semver",
};

const calendarVersionScheme: VersionScheme = {
  compare: compareCalendarVersions,
  description: "calendar version",
  isValid: isCalendarVersion,
  name: "calendar",
};

function versionSchemeFromName(name: string | undefined): VersionScheme {
  switch (name) {
    case undefined:
    case "":
    case "semver": {
      return semverVersionScheme;
    }
    case "calendar": {
      return calendarVersionScheme;
    }
    default: {
      throw new TypeError(`Unknown version scheme: ${name}`);
    }
  }
}

export {
  calendarVersionScheme,
  compareCalendarVersions,
  compareVersions,
  isCalendarVersion,
  isSemver,
  semverVersionScheme,
  versionSchemeFromName,
};
export type { VersionScheme, VersionSchemeName };
