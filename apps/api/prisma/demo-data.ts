/**
 * Development-only demo content for the "demo" school: a realistic Cameroonian
 * francophone secondary structure (6e–Tle), subjects with coefficients, two classes
 * with students and guardians, a teacher account with assignments, and a timetable.
 * Runs once: skipped when the school already has education levels.
 */
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const LEVELS = [
  ['6E', 'Sixième', 'Form 1', 'SECONDARY_FIRST'],
  ['5E', 'Cinquième', 'Form 2', 'SECONDARY_FIRST'],
  ['4E', 'Quatrième', 'Form 3', 'SECONDARY_FIRST'],
  ['3E', 'Troisième', 'Form 4', 'SECONDARY_FIRST'],
  ['2ND', 'Seconde', 'Form 5', 'SECONDARY_SECOND'],
  ['1RE', 'Première', 'Lower Sixth', 'SECONDARY_SECOND'],
  ['TLE', 'Terminale', 'Upper Sixth', 'SECONDARY_SECOND'],
] as const;

const SUBJECTS = [
  ['FRA', 'Français', 'French', 4],
  ['ANG', 'Anglais', 'English', 3],
  ['MATH', 'Mathématiques', 'Mathematics', 4],
  ['SVT', 'Sciences de la vie et de la Terre', 'Biology', 2],
  ['PCT', 'Physique-Chimie-Technologie', 'Physics-Chemistry', 2],
  ['HG', 'Histoire-Géographie', 'History-Geography', 2],
  ['ECM', 'Éducation civique et morale', 'Civics', 1],
  ['EPS', 'Éducation physique et sportive', 'Physical Education', 1],
] as const;

const FIRST = ['Amina', 'Junior', 'Brenda', 'Cédric', 'Danielle', 'Emmanuel', 'Fadimatou', 'Gaël', 'Hervé', 'Inès', 'Jordan', 'Kelly'];
const LAST = ['Mbarga', 'Nkoulou', 'Tchoupo', 'Fotso', 'Ngono', 'Essomba', 'Bello', 'Kamga', 'Abena', 'Owona', 'Djoumessi', 'Atangana'];

export async function seedDemoAcademics(prisma: PrismaClient, tenantId: string, password: string): Promise<boolean> {
  if ((await prisma.educationLevel.count({ where: { tenantId } })) > 0) return false;

  await prisma.$transaction(async (tx) => {
    let year = await tx.academicYear.findFirst({ where: { tenantId, name: '2026-2027' } });
    year ??= await tx.academicYear.create({
      data: { tenantId, name: '2026-2027', startDate: d('2026-09-07'), endDate: d('2027-06-30'), status: 'ACTIVE' },
    });
    const terms = [
      ['Premier trimestre', '2026-09-07', '2026-12-18'],
      ['Deuxième trimestre', '2027-01-04', '2027-03-26'],
      ['Troisième trimestre', '2027-04-06', '2027-06-30'],
    ] as const;
    for (const [i, [name, start, end]] of terms.entries()) {
      await tx.academicPeriod.create({
        data: { tenantId, academicYearId: year.id, kind: 'TERM', name, position: i + 1, startDate: d(start), endDate: d(end) },
      });
    }

    const levels = new Map<string, string>();
    for (const [i, [code, nameFr, nameEn, cycle]] of LEVELS.entries()) {
      const l = await tx.educationLevel.create({ data: { tenantId, code, nameFr, nameEn, cycle, position: i + 1 } });
      levels.set(code, l.id);
    }
    const subjects = new Map<string, { id: string; coef: number }>();
    for (const [code, nameFr, nameEn, coef] of SUBJECTS) {
      const s = await tx.subject.create({ data: { tenantId, code, nameFr, nameEn } });
      subjects.set(code, { id: s.id, coef });
    }

    const campus = await tx.campus.findFirstOrThrow({ where: { tenantId, code: 'MAIN' } });
    const room = await tx.room.create({ data: { tenantId, campusId: campus.id, code: 'S01', name: 'Salle 01', capacity: 60 } });
    await tx.room.create({ data: { tenantId, campusId: campus.id, code: 'S02', name: 'Salle 02', capacity: 60 } });

    const classes = [];
    for (const [code, name, level] of [
      ['6EA', '6e A', '6E'],
      ['3EB', '3e B', '3E'],
    ] as const) {
      const c = await tx.schoolClass.create({
        data: { tenantId, academicYearId: year.id, campusId: campus.id, levelId: levels.get(level)!, code, name, capacity: 60 },
      });
      for (const { id, coef } of subjects.values()) {
        await tx.classSubject.create({ data: { tenantId, classId: c.id, subjectId: id, coefficient: coef, weeklyHours: coef + 1 } });
      }
      classes.push(c);
    }

    // Teacher with a login, assigned to French in both classes.
    const teacherUser = await tx.user.upsert({
      where: { email: 'enseignant@demo.mboka.local' },
      create: { email: 'enseignant@demo.mboka.local', fullName: 'Mme Ngo Bassa', passwordHash: await hashPassword(password) },
      update: {},
    });
    const membership = await tx.membership.create({ data: { tenantId, userId: teacherUser.id } });
    const teacherRole = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'teacher' } } });
    await tx.userRoleAssignment.create({ data: { tenantId, membershipId: membership.id, roleId: teacherRole.id } });
    const teacher = await tx.staff.create({
      data: {
        tenantId,
        membershipId: membership.id,
        staffNumber: 'EMP-0001',
        firstName: 'Sylvie',
        lastName: 'Ngo Bassa',
        gender: 'F',
        position: 'Professeure de français',
        isTeacher: true,
        employmentType: 'PERMANENT',
        hireDate: d('2019-09-02'),
      },
    });
    await tx.tenantCounter.create({ data: { tenantId, key: 'staff', value: 1 } });

    for (const [i, c] of classes.entries()) {
      const fra = await tx.classSubject.findFirstOrThrow({ where: { tenantId, classId: c.id, subjectId: subjects.get('FRA')!.id } });
      await tx.teachingAssignment.create({
        data: { tenantId, academicYearId: year.id, classSubjectId: fra.id, staffId: teacher.id, startDate: d('2026-09-07') },
      });
      await tx.timetableEntry.create({
        data: {
          tenantId,
          academicYearId: year.id,
          classId: c.id,
          subjectLabel: 'Français',
          staffId: teacher.id,
          roomId: room.id,
          weekday: 1,
          startMinute: 7 * 60 + 30 + i * 120,
          endMinute: 9 * 60 + 20 + i * 120,
        },
      });
    }

    // 12 students per class, each with a guardian; the first two share a guardian (siblings).
    const yearPrefix = new Date().getUTCFullYear();
    let seq = 0;
    let sharedGuardianId: string | undefined;
    for (const c of classes) {
      for (let i = 0; i < 12; i++) {
        seq++;
        const lastName = LAST[(i + seq) % LAST.length]!;
        const student = await tx.student.create({
          data: {
            tenantId,
            matricule: `${yearPrefix}-${String(seq).padStart(5, '0')}`,
            firstName: FIRST[i]!,
            lastName,
            gender: i % 2 === 0 ? 'F' : 'M',
            dateOfBirth: d(c.code === '6EA' ? `2015-0${(i % 9) + 1}-1${i % 9}` : `2012-0${(i % 9) + 1}-2${i % 9}`),
            placeOfBirth: 'Douala',
            nationality: 'Camerounaise',
          },
        });
        const guardianId =
          seq <= 2 && sharedGuardianId
            ? sharedGuardianId
            : (
                await tx.guardian.create({
                  data: { tenantId, firstName: 'Parent', lastName, phone: `+237 6${String(70000000 + seq * 1371).slice(0, 8)}` },
                })
              ).id;
        if (seq === 1) sharedGuardianId = guardianId;
        await tx.studentGuardian.create({
          data: { tenantId, studentId: student.id, guardianId, relationship: seq % 2 ? 'MOTHER' : 'FATHER', isPrimary: true, isEmergencyContact: true, canPickUp: true },
        });
        await tx.enrollment.create({
          data: { tenantId, studentId: student.id, academicYearId: year.id, classId: c.id, enrolledOn: d('2026-09-07') },
        });
      }
    }
    await tx.tenantCounter.create({ data: { tenantId, key: `matricule:${yearPrefix}`, value: seq } });
  });
  return true;
}
