/** Response shapes of the endpoints the web app consumes. */

export interface TenantSummary {
  id: string;
  slug: string;
  legalName: string;
  tradingName: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  defaultLocale: string;
}

export interface Me {
  user: { id: string; email: string; fullName: string; locale: string | null; platformRole: string };
  tenants: TenantSummary[];
  csrfToken: string;
}

export interface TenantContextResponse {
  tenant: {
    id: string;
    slug: string;
    legalName: string;
    tradingName: string | null;
    defaultLocale: string;
    timezone: string;
    defaultCurrency: string;
    campuses: { id: string; code: string; name: string }[];
  };
  roles: { key: string; nameFr: string; nameEn: string }[];
  permissions: string[];
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Bilingual {
  nameFr: string;
  nameEn: string;
}

export interface EducationLevel extends Bilingual {
  id: string;
  code: string;
  cycle: string;
  position: number;
}

export interface Subject extends Bilingual {
  id: string;
  code: string;
  category: string | null;
}

export interface SchoolClass {
  id: string;
  academicYearId: string;
  campusId: string;
  levelId: string;
  code: string;
  name: string;
  capacity: number | null;
  level?: Bilingual & { code: string };
  studentCount?: number;
}

export interface ClassDetail extends SchoolClass {
  subjects: { id: string; subjectId: string; coefficient: number; weeklyHours: number; subject: Bilingual & { code: string } }[];
}

export interface StudentRow {
  id: string;
  matricule: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  dateOfBirth: string;
  status: string;
  currentClass: { id: string; code: string; name: string } | null;
  currentYear: string | null;
}

export interface StudentFile extends Omit<StudentRow, 'currentClass' | 'currentYear'> {
  placeOfBirth: string | null;
  nationality: string | null;
  address: string | null;
  guardians: {
    guardianId: string;
    relationship: string;
    isPrimary: boolean;
    isEmergencyContact: boolean;
    canPickUp: boolean;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    portalEnabled: boolean;
  }[];
  portalEnabled: boolean;
  enrollments: {
    id: string;
    status: string;
    enrolledOn: string;
    leftOn: string | null;
    leftReason: string | null;
    class: { id: string; code: string; name: string };
    academicYear: { id: string; name: string };
  }[];
  admissions: { id: string; status: string; academicYear: string; requestedLevel: string; createdAt: string }[];
}

export interface StaffRow {
  id: string;
  staffNumber: string;
  firstName: string;
  lastName: string;
  position: string;
  isTeacher: boolean;
  employmentType: string;
  status: string;
  phone: string | null;
  email: string | null;
  membershipId: string | null;
}

export interface Assignment {
  id: string;
  classSubjectId: string;
  role: string;
  startDate: string;
  endDate: string | null;
  class: { id: string; code: string; name: string };
  subject: Bilingual & { code: string };
  coefficient: number;
  staff: { id: string; firstName: string; lastName: string };
}

export interface TimetableEntry {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  subjectLabel: string;
  class: { id: string; code: string; name: string };
  staff: { id: string; firstName: string; lastName: string } | null;
  room: { id: string; code: string; name: string } | null;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  capacity: number | null;
  campusId: string;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface Register {
  class: { id: string; code: string; name: string };
  date: string;
  slot: string;
  sessionId: string | null;
  version: number;
  canRecord: boolean;
  canCorrect: boolean;
  isToday: boolean;
  students: {
    studentId: string;
    enrollmentId: string;
    matricule: string;
    firstName: string;
    lastName: string;
    status: AttendanceStatus | null;
    arrivalTime: string | null;
    reason: string | null;
  }[];
}

export interface UserRow {
  membershipId: string;
  status: 'ACTIVE' | 'INVITED' | 'REVOKED';
  user: { id: string; email: string; fullName: string; lastLoginAt: string | null };
  roles: (Bilingual & { key: string })[];
  staff: { id: string; staffNumber: string } | null;
  isSelf: boolean;
}

export interface RoleRow extends Bilingual {
  id: string;
  key: string;
  isSystem: boolean;
  permissions: string[];
}
