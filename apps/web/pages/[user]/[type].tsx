import type { GetServerSidePropsContext } from "next";
import { z } from "zod";

import { Booker } from "@calcom/atoms";
import { getBookerWrapperClasses } from "@calcom/features/bookings/Booker/utils/getBookerWrapperClasses";
import { BookerSeo } from "@calcom/features/bookings/components/BookerSeo";
import type { GetBookingType } from "@calcom/features/bookings/lib/get-booking";
import {
  getBookingForReschedule,
  getBookingForSeatedEvent,
  getMultipleDurationValue,
} from "@calcom/features/bookings/lib/get-booking";
import { getSlugOrRequestedSlug, orgDomainConfig } from "@calcom/features/ee/organizations/lib/orgDomains";
import { getUsernameList } from "@calcom/lib/defaultEvents";
import slugify from "@calcom/lib/slugify";
import prisma from "@calcom/prisma";
import getProduct from "@calcom/stripepayment/lib/getProduct";

import type { inferSSRProps } from "@lib/types/inferSSRProps";
import type { EmbedProps } from "@lib/withEmbedSsr";

import PageWrapper from "@components/PageWrapper";

export type PageProps = inferSSRProps<typeof getServerSideProps> & EmbedProps;

export default function Type({
  slug,
  user,
  product,
  isEmbed,
  booking,
  away,
  isBrandingHidden,
  isSEOIndexable,
  rescheduleUid,
  entity,
  duration,
}: PageProps) {
  return (
    <main className={getBookerWrapperClasses({ isEmbed: !!isEmbed })}>
      <BookerSeo
        username={user}
        eventSlug={slug}
        rescheduleUid={rescheduleUid ?? undefined}
        hideBranding={isBrandingHidden}
        isSEOIndexable={isSEOIndexable ?? true}
        entity={entity}
      />
      <Booker
        username={user}
        eventSlug={slug}
        bookingData={booking}
        isAway={away}
        hideBranding={isBrandingHidden}
        entity={entity}
        duration={duration}
        product={product}
      />
    </main>
  );
}

Type.isBookingPage = true;
Type.PageWrapper = PageWrapper;

async function getUserPageProps(context: GetServerSidePropsContext) {
  const { user: usernames, type: slug } = paramsSchema.parse(context.params);
  const username = usernames[0];
  const { rescheduleUid, bookingUid, duration: queryDuration } = context.query;
  const { currentOrgDomain, isValidOrgDomain } = orgDomainConfig(
    context.req.headers.host ?? "",
    context.params?.orgSlug
  );

  const { ssrInit } = await import("@server/lib/ssr");
  const ssr = await ssrInit(context);
  const user = await prisma.user.findFirst({
    where: {
      username,
      organization: isValidOrgDomain && currentOrgDomain ? getSlugOrRequestedSlug(currentOrgDomain) : null,
    },
    select: {
      away: true,
      hideBranding: true,
      allowSEOIndexing: true,
      id: true,
    },
  });

  if (!user) {
    return {
      notFound: true,
    };
  }

  const product = await getProduct(user.id);

  let booking: GetBookingType | null = null;
  if (rescheduleUid) {
    booking = await getBookingForReschedule(`${rescheduleUid}`);
  } else if (bookingUid) {
    booking = await getBookingForSeatedEvent(`${bookingUid}`);
  }

  const org = isValidOrgDomain ? currentOrgDomain : null;
  // We use this to both prefetch the query on the server,
  // as well as to check if the event exist, so we can show a 404 otherwise.
  const eventData = await ssr.viewer.public.event.fetch({
    username,
    eventSlug: slug,
    org,
  });

  if (!eventData) {
    return {
      notFound: true,
    };
  }

  const { unit_amount, currency } = product.default_price;
  return {
    props: {
      booking,
      duration: getMultipleDurationValue(
        eventData.metadata?.multipleDuration,
        queryDuration,
        eventData.length
      ),
      away: user?.away,
      user: username,
      product: { price: unit_amount, currency },
      slug,
      entity: eventData.entity,
      trpcState: ssr.dehydrate(),
      isBrandingHidden: user?.hideBranding,
      isSEOIndexable: user?.allowSEOIndexing,
      themeBasis: username,
      bookingUid: bookingUid ? `${bookingUid}` : null,
      rescheduleUid: rescheduleUid ? `${rescheduleUid}` : null,
    },
  };
}

const paramsSchema = z.object({
  type: z.string().transform((s) => slugify(s)),
  user: z.string().transform((s) => getUsernameList(s)),
});

// Booker page fetches a tiny bit of data server side, to determine early
// whether the page should show an away state or dynamic booking not allowed.
export const getServerSideProps = async (context: GetServerSidePropsContext) => {
  return await getUserPageProps(context);
};
