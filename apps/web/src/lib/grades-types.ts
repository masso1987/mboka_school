import type { MarkStatus } from '@mboka/shared';
import type { Bilingual } from './types';

export interface GradeSheet {
  class: { id: string; code: string; name: string };
  subject: Bilingual & { code: string };
  coefficient: number;
  period: { id: string; name: string; kind: string; startDate: string; endDate: string };
  submission: { status: 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'REOPENED'; submittedAt: string | null; approvedAt: string | null; reopenReason: string | null; everApproved: boolean };
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReopen: boolean;
  assessments: { id: string; name: string; kind: string; maxScore: string; weight: string; heldOn: string | null }[];
  students: {
    studentId: string;
    enrollmentId: string;
    matricule: string;
    firstName: string;
    lastName: string;
    comment: string;
    marks: Record<string, { score: string | null; status: MarkStatus } | null>;
  }[];
}

export interface Period {
  id: string;
  academicYearId: string;
  kind: string;
  name: string;
  position: number;
  startDate: string;
  endDate: string;
}

export interface OverviewRow {
  classSubjectId: string;
  subject: Bilingual & { code: string };
  coefficient: number;
  teacher: string | null;
  assessments: number;
  status: GradeSheet['submission']['status'];
}

export interface CardContent {
  school: { legalName: string; tradingName: string | null };
  academicYear: string;
  scope: { kind: 'PERIOD' | 'ANNUAL'; label: string };
  class: { code: string; name: string; size: number };
  student: { matricule: string; firstName: string; lastName: string; dateOfBirth: string };
  rules: { version: number; maxScore: number; passMark: number; decimals: number; missingPolicy: string; ranking: string };
  subjects: {
    code: string;
    nameFr: string;
    nameEn: string;
    coefficient: string;
    average: string | null;
    points: string | null;
    rank: number | null;
    classAverage: string | null;
    teacher: string | null;
    comment: string | null;
  }[];
  totals: { coefficients: string; points: string };
  average: string | null;
  rank: number | null;
  ranked: number;
  mention: { labelFr: string; labelEn: string } | null;
  passed: boolean | null;
  classStats: { average: string | null; min: string | null; max: string | null; passRate: number | null };
  attendance: { absences: number; excused: number; lates: number };
  decision: string | null;
}

export interface CardRow {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED';
  version: number;
  student: { matricule: string; firstName: string; lastName: string };
  average: string | null;
  rank: number | null;
  ranked: number;
  mention: { labelFr: string; labelEn: string } | null;
}

export interface CardDetail {
  id: string;
  status: CardRow['status'];
  version: number;
  verificationCode: string;
  rulesVersion: number;
  content: CardContent;
  versions: { id: string; version: number; status: string; generatedAt: string }[];
}
