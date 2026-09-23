import { deleteStripeCustomer } from "@calcom/app-store/stripepayment/lib/customer";
import prisma from "@calcom/prisma";
import type { User } from "@calcom/prisma/client";

export async function deleteUser(user: Pick<User, "id" | "email" | "metadata">) {
  // If 2FA is disabled or totpCode is valid then delete the user from stripe and database
  await deleteStripeCustomer(user).catch(console.warn);
  // Flowko: deleting the user cascade-deletes their credentials, so end their Google grants first.
  // Best effort: it never blocks the deletion.
  await import("@calcom/features/credentials/handleDeleteCredential")
    .then(({ revokeGoogleCalendarTokensOfUser }) => revokeGoogleCalendarTokensOfUser(user.id))
    .catch(console.warn);
  // Remove my account
  // TODO: Move this to Repository pattern.
  await prisma.user.delete({
    where: {
      id: user.id,
    },
  });
}
