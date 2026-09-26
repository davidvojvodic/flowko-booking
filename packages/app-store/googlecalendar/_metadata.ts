import process from "node:process";
import { validJson } from "@calcom/lib/jsonUtils";
import type { AppMeta } from "@calcom/types/App";

export const metadata = {
  name: "Google Calendar",
  // Flowko: Flowko instead of Cal.diy as publisher and contact, because Google's OAuth verification reviewer
  // sees this page. The UI shows the description in its own language through getAppDescription
  // (i18n key google_calendar_app_description, English and Slovenian); this is the English text, which
  // must stay equal to that key's English string (_metadata.test.ts).
  description:
    "Connect Google Calendar so that customers cannot book appointments when you are busy, and so that every booking is added to your calendar automatically, updated when it changes and deleted when it is cancelled.",
  installed: !!(process.env.GOOGLE_API_CREDENTIALS && validJson(process.env.GOOGLE_API_CREDENTIALS)),
  type: "google_calendar",
  title: "Google Calendar",
  variant: "calendar",
  category: "calendar",
  categories: ["calendar"],
  logo: "icon.svg",
  publisher: "Flowko",
  slug: "google-calendar",
  url: "https://flowko.si/",
  email: "rezervacije@flowko.si",
  dirName: "googlecalendar",
  isOAuth: true,
  delegationCredential: {
    // This is unused at the moment but should be used in future
    // For now, we have hardcoded imports in the codebase that are supported with Google Workspace(i.e. Google Calendar and Google Meet)
    workspacePlatformSlug: "google",
  },
} as AppMeta;

export default metadata;
