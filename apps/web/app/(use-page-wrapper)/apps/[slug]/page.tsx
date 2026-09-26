import type { PageProps as _PageProps } from "app/_types";
import { generateAppMetadata } from "app/_utils";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getAppDescription } from "@calcom/app-store/_utils/getAppDescription";
import { getLocale } from "@calcom/features/auth/lib/getLocale";

import { getStaticProps } from "@lib/apps/[slug]/getStaticProps";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";

import AppView from "~/apps/[slug]/slug-view";

const paramsSchema = z.object({
  slug: z.string(),
});

export const generateMetadata = async ({ params }: _PageProps) => {
  const p = paramsSchema.safeParse(await params);

  if (!p.success) {
    return notFound();
  }
  const slugFromUrl = p.data.slug;
  const props = await getStaticProps(slugFromUrl);

  if (!props) {
    notFound();
  }
  const { name, logo, dirName: appStoreDirSlug, slug: appSlug, description } = props.data;

  return await generateAppMetadata(
    { slug: appStoreDirSlug ?? appSlug, logoUrl: logo, name, description },
    () => name,
    // Flowko: the meta and Open Graph description in the page's language (Google Calendar's is translated)
    (t) => getAppDescription(props.data, t),
    undefined,
    undefined,
    `/apps/${appSlug}`
  );
};

async function Page({ params }: _PageProps) {
  const p = paramsSchema.safeParse(await params);

  if (!p.success) {
    return notFound();
  }

  // Flowko: the page body in the page's language, with the locale resolved as the root layout resolves it
  const locale = await getLocale(buildLegacyRequest(await headers(), await cookies()));
  const props = await getStaticProps(p.data.slug, locale);

  if (!props) {
    notFound();
  }

  return <AppView {...props} />;
}

export default Page;
