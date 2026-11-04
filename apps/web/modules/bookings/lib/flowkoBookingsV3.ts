// Flowko U19: the bookings calendar view (feature "bookings-v3") is on for every account.
// Upstream ships it off and checks only per-user and team rows (no teams in cal.diy), so
// here an explicit UserFeatures row still wins (enabled=false switches one account off)
// and no row means on. See FLOWKO.md U19.
type UserFeaturesReader = {
  userFeatures: {
    findFirst: (args: {
      where: { userId: number; featureId: string };
      select: { enabled: true };
    }) => Promise<{ enabled: boolean } | null>;
  };
};

export async function isBookingsV3Enabled(prisma: UserFeaturesReader, userId: number): Promise<boolean> {
  const row = await prisma.userFeatures.findFirst({
    where: { userId, featureId: "bookings-v3" },
    select: { enabled: true },
  });
  return row ? row.enabled : true;
}
