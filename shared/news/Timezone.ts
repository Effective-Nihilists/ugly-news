const timezoneValues = [
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Juneau',
  'America/Boise',
  'America/Dawson',
  'America/Chihuahua',
  'America/Phoenix',
  'America/Chicago',
  'America/Regina',
  'America/Mexico_City',
  'America/Belize',
  'America/Detroit',
  'America/Bogota',
  'America/Caracas',
  'America/Santiago',
  'America/St_Johns',
  'America/Sao_Paulo',
  'America/Tijuana',
  'America/Montevideo',
  'America/Argentina/Buenos_Aires',
  'America/Godthab',
  'America/Los_Angeles',
  'Atlantic/Azores',
  'Atlantic/Cape_Verde',
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Africa/Casablanca',
  'Atlantic/Canary',
  'Europe/Belgrade',
  'Europe/Sarajevo',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Africa/Algiers',
  'Europe/Bucharest',
  'Africa/Cairo',
  'Europe/Helsinki',
  'Europe/Athens',
  'Asia/Jerusalem',
  'Africa/Harare',
  'Europe/Moscow',
  'Asia/Kuwait',
  'Africa/Nairobi',
  'Asia/Baghdad',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Baku',
  'Asia/Kabul',
  'Asia/Yekaterinburg',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Colombo',
  'Asia/Almaty',
  'Asia/Rangoon',
  'Asia/Bangkok',
  'Asia/Krasnoyarsk',
  'Asia/Shanghai',
  'Asia/Kuala_Lumpur',
  'Asia/Taipei',
  'Australia/Perth',
  'Asia/Irkutsk',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Yakutsk',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Australia/Brisbane',
  'Australia/Hobart',
  'Asia/Vladivostok',
  'Pacific/Guam',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Pacific/Fiji',
  'Pacific/Auckland',
  'Pacific/Tongatapu',
] as const;

export type Timezone = (typeof timezoneValues)[number];

export const timezoneSet = new Set(timezoneValues);

export const timezones = timezoneValues as unknown as Timezone[];

export const defaultTimezone: Timezone = 'America/Los_Angeles';

/**
 * Returns all timezones from the supported list that are currently at the specified local hour.
 *
 * This is useful for cron jobs that need to execute at a specific local time
 * (e.g., 9am or midnight) for users in different timezones. Instead of loading
 * all records and filtering in-memory, you can query the database for records
 * where `timezone IN getTimezonesAtLocalHour(...)`.
 *
 * @param utcTimestamp - Current time in milliseconds (UTC)
 * @param targetLocalHour - The target hour in local time (0-23)
 * @returns Array of Timezone values that are currently at the target hour
 *
 * @example
 * // Find all timezones where it's currently 9am
 * const timezones = getTimezonesAtLocalHour(Date.now(), 9);
 *
 * // Query only users in those timezones
 * const users = await getDocs({
 *   collection: 'lovePartner',
 *   where: [{ fieldPath: 'timezone', opStr: 'in', value: timezones }],
 * });
 */
export function getTimezonesAtLocalHour(
  utcTimestamp: number,
  targetLocalHour: number,
): Timezone[] {
  const result: Timezone[] = [];
  const utcDate = new Date(utcTimestamp);

  for (const tz of timezones) {
    // Get the current hour in this timezone using Intl.DateTimeFormat
    // This correctly handles DST and non-hour-aligned offsets (e.g., UTC+5:30)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const hourStr = formatter.format(utcDate);
    const localHour = parseInt(hourStr, 10);

    if (localHour === targetLocalHour) {
      result.push(tz);
    }
  }

  return result;
}

/**
 * Get the current local hour (0-23) for a given timezone.
 */
export function getLocalHour(utcTimestamp: number, timezone: Timezone): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(new Date(utcTimestamp)), 10);
}

/**
 * Returns all timezones that crossed a date boundary (midnight) within the last hour.
 *
 * This is useful for daily snapshot/aggregation jobs that need to run once per
 * timezone when the date changes. Handles non-hour-aligned offsets correctly.
 *
 * @param utcTimestamp - Current time in milliseconds (UTC)
 * @returns Array of Timezone values that crossed midnight in the last hour
 *
 * @example
 * // Find all timezones that just crossed midnight
 * const timezones = getTimezonesThatCrossedMidnight(Date.now());
 *
 * // Query only LovePartners in those timezones
 * const partners = await getDocs({
 *   collection: 'lovePartner',
 *   where: [{ fieldPath: 'timezone', opStr: 'in', value: timezones }],
 * });
 */
export function getTimezonesThatCrossedMidnight(
  utcTimestamp: number,
): Timezone[] {
  const result: Timezone[] = [];
  const oneHourAgo = utcTimestamp - 60 * 60 * 1000;

  const nowDate = new Date(utcTimestamp);
  const prevDate = new Date(oneHourAgo);

  for (const tz of timezones) {
    // Get the date string in this timezone for both timestamps
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const currentDateStr = dateFormatter.format(nowDate);
    const previousDateStr = dateFormatter.format(prevDate);

    // If the date changed, this timezone crossed midnight
    if (currentDateStr !== previousDateStr) {
      result.push(tz);
    }
  }

  return result;
}

/**
 * Returns the current date string (YYYY-MM-DD) for a given timezone.
 *
 * @param utcTimestamp - Current time in milliseconds (UTC)
 * @param tz - The timezone to get the date for
 * @returns Date string in YYYY-MM-DD format
 */
export function getDateInTimezone(utcTimestamp: number, tz: Timezone): string {
  const date = new Date(utcTimestamp);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}
