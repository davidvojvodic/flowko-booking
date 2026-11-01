"use client";

import { DEFAULT_DARK_BRAND_COLOR, DEFAULT_LIGHT_BRAND_COLOR } from "@calcom/lib/constants";
import getBrandColours from "@calcom/lib/getBrandColours";
import useTheme from "@calcom/lib/hooks/useTheme";
import useMeQuery from "@calcom/trpc/react/hooks/useMeQuery";
import { useCalcomTheme } from "@calcom/ui/styles";

export const useAppTheme = () => {
  const { data: user } = useMeQuery();
  // Flowko U14: the app always wears Flowko's colours. A host's own colour applies to their public pages.
  const brandTheme = getBrandColours({
    lightVal: DEFAULT_LIGHT_BRAND_COLOR,
    darkVal: DEFAULT_DARK_BRAND_COLOR,
  });
  useCalcomTheme(brandTheme);
  useTheme(user?.appTheme);
};
