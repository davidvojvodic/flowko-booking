import process from "node:process";
import { validJson } from "@calcom/lib/jsonUtils";
import type { AppMeta } from "@calcom/types/App";

export const metadata = {
  name: "Google Calendar",
  // Flowko: Slovenian for every client (the UI is Slovenian), and Flowko instead of Cal.diy as publisher and
  // contact, because Google's OAuth verification reviewer sees this page
  description:
    "Povežite Google Calendar, da stranke ne morejo rezervirati terminov, ko ste zasedeni, in da se vsaka rezervacija samodejno doda v vaš koledar, ob spremembi posodobi in ob odpovedi izbriše.",
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
