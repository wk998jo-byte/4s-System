/** Weekly weather log helpers for Reports (Sunday–Saturday, V1-aligned). */

export const WEATHER_DAY_HOURS = [7, 8, 9, 10, 11, 12, 13, 14] as const;

export type HeatCategory = {
  level: number;
  name: string;
  prevention: string;
};

export type WeatherDayMax = {
  dateIso: string;
  dayLabel: string;
  hoursLogged: number;
  hoursExpected: number;
  wind: number;
  temp: number;
  rh: number;
  co2: number;
  pm10: number;
  heatIndex: number;
  category: HeatCategory;
};

export type WeeklyWeatherLog = {
  id: string;
  project: string;
  week: number;
  weekStartIso: string;
  weekEndIso: string;
  weekLabel: string;
  location: string;
  stationCount: number;
  hoursLogged: number;
  hoursExpected: number;
  maxTemp: number;
  maxHumidity: number;
  maxHeatIndex: number;
  highestCategory: HeatCategory;
  submittedBy: string;
  submittedAtLabel: string;
  remarks: string;
  daysByStation: Array<{
    location: string;
    tableIndex: number;
    tableCount: number;
    days: WeatherDayMax[];
  }>;
};

export type WeatherStation = {
  id: string;
  project: string;
  loc: string;
};

/** Canonical V1 stations (dashboard + hourly log). */
export const WEATHER_STATIONS: WeatherStation[] = [
  { id: "WS-JF-01", project: "Jafurah", loc: "Riyas Laydown" },
  { id: "WS-YB-01", project: "Yanbu", loc: "Tank Farm Gate" },
  { id: "WS-YB-02", project: "Yanbu", loc: "Marine Area" },
  { id: "WS-MG-01", project: "MGS", loc: "Pump Station 2" },
  { id: "WS-RT-01", project: "Ras Tanura", loc: "North Pier" },
];

export const WEATHER_PROJECTS = ["Jafurah", "MGS", "Yanbu", "Ras Tanura"] as const;

const STATIONS: Record<string, string[]> = {
  Jafurah: ["Riyas Laydown"],
  MGS: ["Pump Station 2"],
  Yanbu: ["Tank Farm Gate", "Marine Area"],
  "Ras Tanura": ["North Pier"],
};

const SUBMITTERS = ["Nawaz", "Fajr", "Leena", "Noot"];

export const WEATHER_SUBMITTERS = SUBMITTERS;

function projectCode(name: string, index = 0) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 3) || `P${index + 1}`).padEnd(3, "X").slice(0, 3);
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sundayWeekBounds(day: Date) {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const daysSinceSunday = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - daysSinceSunday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/** Sunday-start week number; week 1 contains 1 January. */
export function sundayWeekParts(day: Date): { year: number; week: number } {
  const value = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const jan1 = new Date(value.getFullYear(), 0, 1);
  const week1Sunday = new Date(jan1);
  week1Sunday.setDate(jan1.getDate() - jan1.getDay());
  if (value < week1Sunday) {
    return sundayWeekParts(new Date(value.getFullYear() - 1, 11, 31));
  }
  const diffDays = Math.floor((value.getTime() - week1Sunday.getTime()) / 86400000);
  return { year: value.getFullYear(), week: Math.floor(diffDays / 7) + 1 };
}

export function heatCategory(h: number): HeatCategory {
  if (h >= 54) {
    return {
      level: 4,
      name: "Extreme Danger",
      prevention: "Stop outdoor work. Emergency cooling and medical standby.",
    };
  }
  if (h >= 41) {
    return {
      level: 3,
      name: "Danger",
      prevention:
        "Work/rest 15/45 min, one cup of water every 15 minutes, supervisor check every hour.",
    };
  }
  if (h >= 32) {
    return {
      level: 2,
      name: "Extreme Caution",
      prevention: "Work/rest 30/30 min in shade, one cup of water every 15 minutes.",
    };
  }
  if (h >= 27) {
    return {
      level: 1,
      name: "Caution",
      prevention: "One cup of water every 20 minutes, shaded rest breaks.",
    };
  }
  return {
    level: 0,
    name: "Normal",
    prevention: "One cup of water every 20 minutes.",
  };
}

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(...parts: Array<string | number>) {
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function formatShortDay(d: Date) {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${mon[d.getMonth()]}`;
}

function formatDayName(d: Date) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}

function formatSubmittedAt(d: Date) {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${mon[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function stationsFor(project: string) {
  return STATIONS[project] ?? [`${project} Site`];
}

function hourLabel(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${suffix}`;
}

export type HourlyWeatherRow = {
  hour: number;
  timeLabel: string;
  status: "ok" | "missing" | "upcoming";
  wind?: number;
  temp?: number;
  rh?: number;
  co2?: number;
  pm25?: number;
  pm10?: number;
  heatIndex?: number;
  category?: HeatCategory;
  remarks?: string;
  loggedBy?: string;
};

export type DailyStationWeather = {
  project: string;
  location: string;
  dateIso: string;
  dateLabel: string;
  week: number;
  hours: HourlyWeatherRow[];
};

export function hourlyRowsForDay(
  project: string,
  location: string,
  day: Date,
  now: Date,
): HourlyWeatherRow[] {
  const iso = isoDate(day);
  const isFutureDay = day.getTime() > now.getTime() && iso !== isoDate(now);
  const rnd = mulberry(hashSeed(project, location, iso));
  const month = day.getMonth();
  const coastal = project === "Yanbu" || project === "Ras Tanura";
  const baseTemp =
    [21, 23, 27, 32, 37, 40, 42, 42, 39, 35, 29, 23][month] +
    (project === "MGS" ? 1.5 : coastal ? -1.5 : 0) +
    (rnd() - 0.5) * 3;

  return WEATHER_DAY_HOURS.map((hour, i) => {
    const timeLabel = hourLabel(hour);
    if (isFutureDay || (iso === isoDate(now) && hour > now.getHours())) {
      return { hour, timeLabel, status: "upcoming" as const };
    }
    // Rare missing reading for past hours.
    if (rnd() < 0.015) {
      return { hour, timeLabel, status: "missing" as const };
    }
    const T = Math.round((baseTemp - 8 + i * 1.2 + (rnd() - 0.5) * 1.4) * 10) / 10;
    const RH = Math.max(
      8,
      Math.min(90, Math.round(38 - i * 2 + (coastal ? 12 : 0) + (rnd() - 0.5) * 8)),
    );
    const W = Math.round((2.5 + rnd() * 6 + (i > 3 ? 1.2 : 0)) * 10) / 10;
    const C = Math.round(560 + rnd() * 50);
    const pm25 = Math.round(12 + rnd() * 30 + (rnd() < 0.06 ? 40 : 0));
    const P = Math.round(pm25 * (1.6 + rnd() * 1.4));
    const hi =
      Math.round(
        (T +
          (RH > 40 ? (RH - 40) * 0.08 : 0) +
          (T > 32 ? (T - 32) * 0.35 : 0) +
          rnd() * 0.4) *
          10,
      ) / 10;
    const cat = heatCategory(hi);
    const remarks =
      cat.level >= 2
        ? "Heat stress controls applied"
        : W > 8
          ? "Dusty, windy conditions"
          : "Normal weather";
    return {
      hour,
      timeLabel,
      status: "ok" as const,
      wind: W,
      temp: T,
      rh: RH,
      co2: C,
      pm25,
      pm10: P,
      heatIndex: hi,
      category: cat,
      remarks,
      loggedBy: SUBMITTERS[hashSeed(project, location, iso, hour) % SUBMITTERS.length],
    };
  });
}

export function dayMaxFor(
  project: string,
  location: string,
  day: Date,
  now: Date,
): WeatherDayMax | null {
  const iso = isoDate(day);
  if (day.getTime() > now.getTime() && iso !== isoDate(now)) {
    return null;
  }
  const hours = hourlyRowsForDay(project, location, day, now).filter((h) => h.status === "ok");
  if (!hours.length) return null;
  let wind = 0;
  let temp = 0;
  let rh = 0;
  let co2 = 0;
  let pm10 = 0;
  let heatIndex = 0;
  for (const row of hours) {
    wind = Math.max(wind, row.wind ?? 0);
    temp = Math.max(temp, row.temp ?? 0);
    rh = Math.max(rh, row.rh ?? 0);
    co2 = Math.max(co2, row.co2 ?? 0);
    pm10 = Math.max(pm10, row.pm10 ?? 0);
    heatIndex = Math.max(heatIndex, row.heatIndex ?? 0);
  }
  return {
    dateIso: iso,
    dayLabel: `${formatDayName(day)} ${formatShortDay(day)}`,
    hoursLogged: hours.length,
    hoursExpected: WEATHER_DAY_HOURS.length,
    wind: Math.round(wind * 10) / 10,
    temp: Math.round(temp * 10) / 10,
    rh,
    co2,
    pm10,
    heatIndex: Math.round(heatIndex * 10) / 10,
    category: heatCategory(heatIndex),
  };
}

/** One hourly table per station/location for a daily (all-projects) report. */
export function buildDailyWeatherTables(
  dateIso: string,
  projects: string[],
  now = new Date(),
): DailyStationWeather[] {
  const day = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(day.getTime())) return [];
  const { week } = sundayWeekParts(day);
  const dateLabel = `${day.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][day.getMonth()]} ${day.getFullYear()}`;
  const tables: DailyStationWeather[] = [];
  for (const project of projects) {
    for (const location of stationsFor(project)) {
      tables.push({
        project,
        location,
        dateIso,
        dateLabel,
        week,
        hours: hourlyRowsForDay(project, location, day, now),
      });
    }
  }
  return tables;
}

export function buildWeeklyWeatherLogs(
  projects: string[],
  now = new Date(),
  weekCount = 3,
): WeeklyWeatherLog[] {
  const { start: currentSunday } = sundayWeekBounds(now);
  const logs: WeeklyWeatherLog[] = [];

  // Completed weeks only (skip current in-progress week), newest first.
  for (let offset = 1; offset <= weekCount; offset += 1) {
    const weekStart = new Date(currentSunday);
    weekStart.setDate(currentSunday.getDate() - 7 * offset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const { week } = sundayWeekParts(weekEnd);
    const submitAt = new Date(weekEnd);
    submitAt.setDate(weekEnd.getDate() + 1);
    submitAt.setHours(9, 0, 0, 0);

    projects.forEach((project, projectIndex) => {
      const stations = stationsFor(project);
      const daysByStation = stations.map((location, tableIndex) => {
        const days: WeatherDayMax[] = [];
        for (let i = 0; i < 7; i += 1) {
          const day = new Date(weekStart);
          day.setDate(weekStart.getDate() + i);
          const max = dayMaxFor(project, location, day, now);
          if (max) days.push(max);
          else {
            days.push({
              dateIso: isoDate(day),
              dayLabel: `${formatDayName(day)} ${formatShortDay(day)}`,
              hoursLogged: 0,
              hoursExpected: WEATHER_DAY_HOURS.length,
              wind: 0,
              temp: 0,
              rh: 0,
              co2: 0,
              pm10: 0,
              heatIndex: 0,
              category: heatCategory(0),
            });
          }
        }
        return {
          location,
          tableIndex: tableIndex + 1,
          tableCount: stations.length,
          days,
        };
      });

      let hoursLogged = 0;
      let hoursExpected = 0;
      let maxTemp = 0;
      let maxHumidity = 0;
      let maxHeatIndex = 0;
      let highest = heatCategory(0);
      for (const station of daysByStation) {
        for (const day of station.days) {
          hoursLogged += day.hoursLogged;
          hoursExpected += day.hoursExpected;
          if (day.hoursLogged <= 0) continue;
          maxTemp = Math.max(maxTemp, day.temp);
          maxHumidity = Math.max(maxHumidity, day.rh);
          if (day.heatIndex >= maxHeatIndex) {
            maxHeatIndex = day.heatIndex;
            highest = day.category;
          }
        }
      }

      const submitter =
        SUBMITTERS[hashSeed(project, week, weekStart.getTime()) % SUBMITTERS.length];

      logs.push({
        id: `WWL-${week}-${projectCode(project, projectIndex)}`,
        project,
        week,
        weekStartIso: isoDate(weekStart),
        weekEndIso: isoDate(weekEnd),
        weekLabel: `Week ${week} · ${formatShortDay(weekStart)}`,
        location: stations[0],
        stationCount: stations.length,
        hoursLogged,
        hoursExpected,
        maxTemp: Math.round(maxTemp * 10) / 10,
        maxHumidity,
        maxHeatIndex: Math.round(maxHeatIndex * 10) / 10,
        highestCategory: highest,
        submittedBy: submitter,
        submittedAtLabel: formatSubmittedAt(submitAt),
        remarks: "Work/rest regime applied on high heat-index hours.",
        daysByStation,
      });
    });
  }

  return logs;
}

export function buildWeatherLogForWeek(
  project: string,
  weekStartIso: string,
  projectIndex = 0,
  now = new Date(),
): WeeklyWeatherLog {
  const weekStart = new Date(`${weekStartIso}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const { week } = sundayWeekParts(weekEnd);
  const stations = stationsFor(project);
  const submitAt = new Date(Math.min(weekEnd.getTime() + 86400000, now.getTime()));
  submitAt.setHours(9, 0, 0, 0);

  const daysByStation = stations.map((location, tableIndex) => {
    const days: WeatherDayMax[] = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      const max = dayMaxFor(project, location, day, now);
      days.push(
        max ?? {
          dateIso: isoDate(day),
          dayLabel: `${formatDayName(day)} ${formatShortDay(day)}`,
          hoursLogged: 0,
          hoursExpected: WEATHER_DAY_HOURS.length,
          wind: 0,
          temp: 0,
          rh: 0,
          co2: 0,
          pm10: 0,
          heatIndex: 0,
          category: heatCategory(0),
        },
      );
    }
    return {
      location,
      tableIndex: tableIndex + 1,
      tableCount: stations.length,
      days,
    };
  });

  let hoursLogged = 0;
  let hoursExpected = 0;
  let maxTemp = 0;
  let maxHumidity = 0;
  let maxHeatIndex = 0;
  let highest = heatCategory(0);
  for (const station of daysByStation) {
    for (const day of station.days) {
      hoursLogged += day.hoursLogged;
      hoursExpected += day.hoursExpected;
      if (day.hoursLogged <= 0) continue;
      maxTemp = Math.max(maxTemp, day.temp);
      maxHumidity = Math.max(maxHumidity, day.rh);
      if (day.heatIndex >= maxHeatIndex) {
        maxHeatIndex = day.heatIndex;
        highest = day.category;
      }
    }
  }

  return {
    id: `WWL-${week}-${projectCode(project, projectIndex)}`,
    project,
    week,
    weekStartIso: isoDate(weekStart),
    weekEndIso: isoDate(weekEnd),
    weekLabel: `Week ${week} · ${formatShortDay(weekStart)}`,
    location: stations[0],
    stationCount: stations.length,
    hoursLogged,
    hoursExpected,
    maxTemp: Math.round(maxTemp * 10) / 10,
    maxHumidity,
    maxHeatIndex: Math.round(maxHeatIndex * 10) / 10,
    highestCategory: highest,
    submittedBy: SUBMITTERS[hashSeed(project, week, weekStart.getTime()) % SUBMITTERS.length],
    submittedAtLabel: formatSubmittedAt(submitAt),
    remarks: "Work/rest regime applied on high heat-index hours.",
    daysByStation,
  };
}

export function weatherLogForReport(
  logs: WeeklyWeatherLog[],
  project: string,
  weekStartIso: string,
  projectIndex = 0,
) {
  const existing = logs.find(
    (log) => log.project === project && log.weekStartIso === weekStartIso,
  );
  if (existing) return existing;
  if (!project || project === "All projects" || !weekStartIso) return null;
  return buildWeatherLogForWeek(project, weekStartIso, projectIndex);
}

/** One max-values row per station for a monthly project report. */
export type MonthlyStationWeatherMax = {
  station: string;
  hoursLogged: number;
  maxTemp: number;
  maxHeatIndex: number;
  category: HeatCategory;
  maxWind: number;
  maxHumidity: number;
  maxPm10: number;
};

export function buildMonthlyWeatherMaxes(
  project: string,
  fromIso: string,
  toIso: string,
  now = new Date(),
): MonthlyStationWeatherMax[] {
  if (!project || project === "All projects") return [];
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return [];
  }

  return stationsFor(project).map((location) => {
    let hoursLogged = 0;
    let maxTemp = 0;
    let maxHeatIndex = 0;
    let maxWind = 0;
    let maxHumidity = 0;
    let maxPm10 = 0;
    let highest = heatCategory(0);

    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const dayMax = dayMaxFor(project, location, cursor, now);
      if (dayMax && dayMax.hoursLogged > 0) {
        hoursLogged += dayMax.hoursLogged;
        maxTemp = Math.max(maxTemp, dayMax.temp);
        maxWind = Math.max(maxWind, dayMax.wind);
        maxHumidity = Math.max(maxHumidity, dayMax.rh);
        maxPm10 = Math.max(maxPm10, dayMax.pm10);
        if (dayMax.heatIndex >= maxHeatIndex) {
          maxHeatIndex = dayMax.heatIndex;
          highest = dayMax.category;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      station: `${location} (${project})`,
      hoursLogged,
      maxTemp: Math.round(maxTemp * 10) / 10,
      maxHeatIndex: Math.round(maxHeatIndex * 10) / 10,
      category: highest,
      maxWind: Math.round(maxWind * 10) / 10,
      maxHumidity,
      maxPm10,
    };
  });
}

export type WeatherPeriodId =
  | "today"
  | "week"
  | "lastweek"
  | "month"
  | "lastmonth"
  | "ytd";

export function weatherPeriodRange(period: WeatherPeriodId, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today.getTime() + 86400000 - 1);
  const labelMon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d: Date) => `${d.getDate()} ${labelMon[d.getMonth()]}`;
  if (period === "today") {
    return { a: today, b: end, label: `${fmt(today)} ${today.getFullYear()} (Today)` };
  }
  if (period === "week") {
    const { start } = sundayWeekBounds(today);
    return { a: start, b: end, label: `${fmt(start)} to ${fmt(today)} (This week)` };
  }
  if (period === "lastweek") {
    const { start: thisSun } = sundayWeekBounds(today);
    const start = new Date(thisSun);
    start.setDate(start.getDate() - 7);
    const lastEnd = new Date(thisSun);
    lastEnd.setDate(lastEnd.getDate() - 1);
    return {
      a: start,
      b: new Date(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate(), 23, 59, 59),
      label: `${fmt(start)} to ${fmt(lastEnd)} (Last week)`,
    };
  }
  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { a: start, b: end, label: `${fmt(start)} to ${fmt(today)} (This month)` };
  }
  if (period === "lastmonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      a: start,
      b: new Date(lastEnd.getFullYear(), lastEnd.getMonth(), lastEnd.getDate(), 23, 59, 59),
      label: `${fmt(start)} to ${fmt(lastEnd)} (Last month)`,
    };
  }
  const start = new Date(today.getFullYear(), 0, 1);
  return { a: start, b: end, label: `1 Jan to ${fmt(today)} ${today.getFullYear()} (Year to date)` };
}

export type StationDayMax = {
  station: WeatherStation;
  t: number;
  dateIso: string;
  T: number;
  RH: number;
  hi: number;
  wind: number;
  pm25: number;
  pm10: number;
  co2: number;
  n: number;
  category: HeatCategory;
};

export function stationDayMaxes(
  project: string,
  from: Date,
  to: Date,
  now = new Date(),
): StationDayMax[] {
  const out: StationDayMax[] = [];
  const stations =
    project === "All"
      ? WEATHER_STATIONS
      : WEATHER_STATIONS.filter((s) => s.project === project);
  for (const st of stations) {
    for (let t = sodMs(from); t <= to.getTime(); t += 86400000) {
      const day = new Date(t);
      const max = dayMaxFor(st.project, st.loc, day, now);
      if (!max || max.hoursLogged <= 0) continue;
      const hours = hourlyRowsForDay(st.project, st.loc, day, now).filter((h) => h.status === "ok");
      let pm25 = 0;
      for (const h of hours) pm25 = Math.max(pm25, h.pm25 ?? 0);
      out.push({
        station: st,
        t,
        dateIso: max.dateIso,
        T: max.temp,
        RH: max.rh,
        hi: max.heatIndex,
        wind: max.wind,
        pm25,
        pm10: max.pm10,
        co2: max.co2,
        n: max.hoursLogged,
        category: max.category,
      });
    }
  }
  return out;
}

function sodMs(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function latestStationReading(st: WeatherStation, now = new Date()) {
  for (let i = 0; i < 5; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const hours = hourlyRowsForDay(st.project, st.loc, day, now).filter((h) => h.status === "ok");
    if (!hours.length) continue;
    const last = hours[hours.length - 1];
    return {
      ...last,
      day,
      dateIso: isoDate(day),
      isToday: isoDate(day) === isoDate(now),
    };
  }
  return null;
}

export function monthlyHiByProject(project: string | "All", now = new Date()) {
  const year = now.getFullYear();
  const months = now.getMonth() + 1;
  const projects =
    project === "All"
      ? [...WEATHER_PROJECTS]
      : WEATHER_PROJECTS.filter((p) => p === project);
  return projects.map((p) => {
    const values: number[] = [];
    for (let mi = 0; mi < months; mi += 1) {
      let mx = 0;
      const dim = new Date(year, mi + 1, 0).getDate();
      for (const st of WEATHER_STATIONS.filter((s) => s.project === p)) {
        for (let d = 1; d <= dim; d += 1) {
          const day = new Date(year, mi, d);
          if (day > now) continue;
          const max = dayMaxFor(st.project, st.loc, day, now);
          if (max) mx = Math.max(mx, max.heatIndex);
        }
      }
      values.push(mx);
    }
    return { project: p, values };
  });
}
