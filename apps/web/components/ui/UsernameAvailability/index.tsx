import { IS_SELF_HOSTED, WEBSITE_URL } from "@calcom/lib/constants";
import type { RouterOutputs } from "@calcom/trpc/react";
import { trpc } from "@calcom/trpc/react";
import type { AppRouter } from "@calcom/trpc/types/server/routers/_app";
import useRouterQuery from "@lib/hooks/useRouterQuery";
import type { TRPCClientErrorLike } from "@trpc/client";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { ReactNode, RefCallback } from "react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

type UsernameFieldUser = Pick<RouterOutputs["viewer"]["me"]["get"], "username" | "organization">;

interface UsernameAvailabilityFieldProps {
  onSuccessMutation?: () => void;
  onErrorMutation?: (error: TRPCClientErrorLike<AppRouter>) => void;
  disabled?: boolean;
  // Flowko U20: the user the page already holds (server-fetched), so the field never queries during SSR.
  user?: UsernameFieldUser;
}

interface ICustomUsernameProps extends UsernameAvailabilityFieldProps {
  currentUsername: string | undefined;
  setCurrentUsername?: (newUsername: string) => void;
  inputUsernameValue: string | undefined;
  usernameRef: RefCallback<HTMLInputElement>;
  setInputUsernameValue: (value: string) => void;
  disabled?: boolean | undefined;
  addOnLeading?: ReactNode;
  isPremium: boolean;
}

const PremiumTextfield = dynamic(() => import("./PremiumTextfield").then((m) => m.PremiumTextfield), {
  ssr: false,
});
const UsernameTextfield = dynamic(() => import("./UsernameTextfield").then((m) => m.UsernameTextfield), {
  ssr: false,
});

const UsernameAvailabilityFieldWithUser = ({
  onSuccessMutation,
  onErrorMutation,
  disabled,
  user,
}: Omit<UsernameAvailabilityFieldProps, "user"> & { user: UsernameFieldUser }) => {
  const searchParams = useSearchParams();
  const [currentUsernameState, setCurrentUsernameState] = useState(user.username || "");
  const { username: usernameFromQuery, setQuery: setUsernameFromQuery } = useRouterQuery("username");
  const { username: currentUsername, setQuery: setCurrentUsername } =
    searchParams?.get("username") && user.username === null
      ? { username: usernameFromQuery, setQuery: setUsernameFromQuery }
      : { username: currentUsernameState || "", setQuery: setCurrentUsernameState };
  const formMethods = useForm({
    defaultValues: {
      username: currentUsername,
    },
  });

  const orgBranding = null;

  const usernamePrefix = orgBranding
    ? "".replace(/^(https?:|)\/\//, "")
    : `${WEBSITE_URL?.replace(/^(https?:|)\/\//, "")}`;

  const isPremium = !IS_SELF_HOSTED && !user.organization?.id;

  return (
    <Controller
      control={formMethods.control}
      name="username"
      render={({ field: { ref, onChange, value } }) => (
        <UsernameAvailability
          currentUsername={currentUsername}
          setCurrentUsername={setCurrentUsername}
          inputUsernameValue={value}
          usernameRef={ref}
          setInputUsernameValue={onChange}
          onSuccessMutation={onSuccessMutation}
          onErrorMutation={onErrorMutation}
          disabled={disabled ?? !!user.organization?.id}
          addOnLeading={`${usernamePrefix}/`}
          isPremium={isPremium}
        />
      )}
    />
  );
};

export const UsernameAvailability = (props: ICustomUsernameProps) => {
  const { isPremium, disabled, ...otherProps } = props;
  const UsernameAvailabilityComponent = isPremium ? PremiumTextfield : UsernameTextfield;
  // PremiumTextfield uses `readonly` prop, UsernameTextfield uses `disabled` prop
  const componentProps = isPremium ? { ...otherProps, readonly: disabled } : { ...otherProps, disabled };
  return <UsernameAvailabilityComponent {...componentProps} />;
};

// Flowko U20: no suspense query here. useSuspenseQuery ran during the server render without the
// user's cookies, failed with UNAUTHORIZED and turned the page section into React #419. Callers pass
// the user they already have; without it the field waits for a normal query behind a placeholder.
export const UsernameAvailabilityField = ({
  user: userFromProps,
  ...props
}: UsernameAvailabilityFieldProps) => {
  const { data: userFromQuery } = trpc.viewer.me.get.useQuery(undefined, { enabled: !userFromProps });
  const user = userFromProps ?? userFromQuery;
  if (!user) return <div aria-hidden="true" data-testid="username-field-placeholder" className="h-16" />;
  return <UsernameAvailabilityFieldWithUser {...props} user={user} />;
};
