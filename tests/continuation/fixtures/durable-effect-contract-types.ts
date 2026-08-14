export interface EffectReceipt {
  readonly schemaVersion: 1;
  readonly operationKey: string;
}

export interface FilingReport {
  readonly month: string;
  readonly ready: number;
}

export interface EffectResult {
  readonly onSuccess: boolean;
  readonly onFailure: boolean;
  readonly report: FilingReport;
  readonly stepReport: string;
}

