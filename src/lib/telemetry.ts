export type TelemetrySeverity = 'warn' | 'error';

export interface InvariantViolationEvent {
  code: string;
  severity: TelemetrySeverity;
  message: string;
  timestamp: number;
  context?: Record<string, string | number | boolean | null>;
}

const MAX_BUFFER = 50;
const recentViolations: InvariantViolationEvent[] = [];

/**
 * Records a runtime invariant violation without including customer PII.
 * Feeds production anomalies back into Quality Gate regression rules.
 */
export function reportInvariantViolation(
  code: string,
  message: string,
  context?: Record<string, string | number | boolean | null>,
  severity: TelemetrySeverity = 'warn',
): InvariantViolationEvent {
  const event: InvariantViolationEvent = {
    code,
    severity,
    message,
    timestamp: Date.now(),
    ...(context ? { context } : {}),
  };

  recentViolations.push(event);
  if (recentViolations.length > MAX_BUFFER) {
    recentViolations.shift();
  }

  if (process.env.NODE_ENV !== 'test') {
    const payload = JSON.stringify({ type: 'rxflow.invariant_violation', ...event });
    if (typeof console !== 'undefined') {
      if (severity === 'error') console.error(payload);
      else console.warn(payload);
    }

    const endpoint = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT;
    if (
      endpoint &&
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function'
    ) {
      try {
        navigator.sendBeacon(endpoint, payload);
      } catch {
        // Telemetry must never disrupt pharmacist workflow.
      }
    }
  }

  return event;
}

export function getRecentViolations(): readonly InvariantViolationEvent[] {
  return recentViolations;
}

export function clearTelemetryBuffer(): void {
  recentViolations.length = 0;
}
