import type { Tx } from '../prisma/prisma.service';

/**
 * Who someone is in a school, for targeting and for what they may see:
 * a parent (guardian account), a student (student account), or staff (any other member).
 */
export interface Identity {
  guardianId: string | null;
  studentId: string | null;
  /** Children's ids for a parent, own id for a student. */
  studentIds: string[];
  /** Classes those students are currently enrolled in. */
  classIds: string[];
  isStaff: boolean;
}

const ACTIVE = ['ENROLLED', 'REPEATING'] as const;

export async function identityOf(tx: Tx, tenantId: string, membershipId: string): Promise<Identity> {
  const [guardian, student] = await Promise.all([
    tx.guardian.findFirst({ where: { tenantId, membershipId }, select: { id: true, students: { select: { studentId: true } } } }),
    tx.student.findFirst({ where: { tenantId, membershipId }, select: { id: true } }),
  ]);
  const studentIds = [...(guardian?.students.map((s) => s.studentId) ?? []), ...(student ? [student.id] : [])];
  const enrollments = studentIds.length
    ? await tx.enrollment.findMany({ where: { tenantId, studentId: { in: studentIds }, status: { in: [...ACTIVE] } }, select: { classId: true } })
    : [];
  return {
    guardianId: guardian?.id ?? null,
    studentId: student?.id ?? null,
    studentIds,
    classIds: [...new Set(enrollments.map((e) => e.classId))],
    isStaff: !guardian && !student,
  };
}

/** Active members' user ids for an announcement audience (COM-003). */
export async function audienceUsers(tx: Tx, tenantId: string, audience: string, classId: string | null): Promise<string[]> {
  const members = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, userId: true } });
  const userOf = new Map(members.map((m) => [m.id, m.userId]));
  const guardianMemberships = (await tx.guardian.findMany({ where: { tenantId, membershipId: { not: null } }, select: { membershipId: true, students: { select: { studentId: true } } } }));
  const studentMemberships = (await tx.student.findMany({ where: { tenantId, membershipId: { not: null } }, select: { id: true, membershipId: true } }));
  const family = new Set([...guardianMemberships.map((g) => g.membershipId!), ...studentMemberships.map((s) => s.membershipId!)]);
  const pick = (ids: (string | null)[]) => ids.flatMap((id) => (id && userOf.has(id) ? [userOf.get(id)!] : []));

  switch (audience) {
    case 'ALL':
      return [...userOf.values()];
    case 'STAFF':
      return members.filter((m) => !family.has(m.id)).map((m) => m.userId);
    case 'GUARDIANS':
      return pick(guardianMemberships.map((g) => g.membershipId));
    case 'STUDENTS':
      return pick(studentMemberships.map((s) => s.membershipId));
    case 'CLASS': {
      const inClass = new Set(
        (await tx.enrollment.findMany({ where: { tenantId, classId: classId!, status: { in: [...ACTIVE] } }, select: { studentId: true } })).map((e) => e.studentId),
      );
      return pick([
        ...guardianMemberships.filter((g) => g.students.some((s) => inClass.has(s.studentId))).map((g) => g.membershipId),
        ...studentMemberships.filter((s) => inClass.has(s.id)).map((s) => s.membershipId),
      ]);
    }
    default:
      return [];
  }
}
