import { prisma } from "./db.server";

export async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === "admin";
}

export async function getAdminStats() {
  const [totalUsers, totalEvents] = await Promise.all([
    prisma.user.count(),
    prisma.event.count(),
  ]);
  return { totalUsers, totalEvents };
}

export async function listUsers({ page, pageSize, search }: { page: number; pageSize: number; search?: string }) {
  const where = search
    ? { OR: [{ name: { contains: search } }, { email: { contains: search } }, { id: { contains: search } }] }
    : {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);
  return { users, total };
}
