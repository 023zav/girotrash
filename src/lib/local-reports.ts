import { STORAGE_KEYS } from './constants';
import type { LocalReport } from '../types';

const MAX_STORED = 50;

export function getLocalReports(): LocalReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.myReports);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalReport(report: LocalReport) {
  const reports = getLocalReports();
  reports.unshift(report);
  if (reports.length > MAX_STORED) reports.length = MAX_STORED;
  localStorage.setItem(STORAGE_KEYS.myReports, JSON.stringify(reports));
}
