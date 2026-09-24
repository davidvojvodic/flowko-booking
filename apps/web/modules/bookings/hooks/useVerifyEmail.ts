import { useState } from "react";

import { useBookerStore } from "@calcom/features/bookings/Booker/store";
import { useDebounce } from "@calcom/lib/hooks/useDebounce";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { showToast } from "@calcom/ui/components/toast";

export interface IUseVerifyEmailProps {
  email: string;
  onVerifyEmail?: () => void;
  name?: string | { firstName: string; lastname?: string };
  requiresBookerEmailVerification?: boolean;
  eventTypeId?: number;
}
export type UseVerifyEmailReturnType = ReturnType<typeof useVerifyEmail>;
export const useVerifyEmail = ({
  email,
  name,
  requiresBookerEmailVerification,
  onVerifyEmail,
  eventTypeId,
}: IUseVerifyEmailProps) => {
  const [isEmailVerificationModalVisible, setEmailVerificationModalVisible] = useState(false);
  const verifiedEmail = useBookerStore((state) => state.verifiedEmail);
  const setVerifiedEmail = useBookerStore((state) => state.setVerifiedEmail);
  const isRescheduling = useBookerStore((state) => Boolean(state.rescheduleUid && state.bookingData));
  const debouncedEmail = useDebounce(email, 600);

  const { t, i18n } = useLocale();
  const sendEmailVerificationByCodeMutation = trpc.viewer.auth.sendVerifyEmailCode.useMutation({
    onSuccess: () => {
      setEmailVerificationModalVisible(true);
      showToast(t("email_sent"), "success");
    },
    onError: () => {
      showToast(t("email_not_sent"), "error");
    },
  });

  const { data: isEmailVerificationRequired } =
    trpc.viewer.public.checkIfUserEmailVerificationRequired.useQuery(
      // Flowko: only the email. The server reads the signed-in booker's own email from the session.
      {
        email: debouncedEmail,
      },
      {
        enabled: !!debouncedEmail && !isRescheduling,
        // Flowko: the server limits this check to 10 a minute per IP, shared by every booker behind that IP,
        // so ask once per email. Booking re-checks it on the server, so a cached answer is never trusted.
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000,
      }
    );

  const handleVerifyEmail = () => {
    onVerifyEmail?.();

    sendEmailVerificationByCodeMutation.mutate({
      email,
      username: typeof name === "string" ? name : name?.firstName,
      language: i18n.language || "en",
      eventTypeId,
    });
  };

  const isVerificationCodeSending = sendEmailVerificationByCodeMutation.isPending;

  const renderConfirmNotVerifyEmailButtonCond =
    isRescheduling ||
    (!requiresBookerEmailVerification && !isEmailVerificationRequired) ||
    (email && verifiedEmail && verifiedEmail === email);

  return {
    handleVerifyEmail,
    isEmailVerificationModalVisible,
    setEmailVerificationModalVisible,
    setVerifiedEmail,
    renderConfirmNotVerifyEmailButtonCond: Boolean(renderConfirmNotVerifyEmailButtonCond),
    isVerificationCodeSending,
  };
};
