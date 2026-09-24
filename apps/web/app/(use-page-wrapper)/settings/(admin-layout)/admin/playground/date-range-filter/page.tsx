import { requireActiveAdmin } from "../../../requireActiveAdmin";
import DateRangeFilterPlayground from "./DateRangeFilterPlayground";

const Page = async () => {
  // Flowko: the page was a client component and relied on the layouts for the admin check, which a partial
  // render can skip. It is now a server page that checks first and then renders the playground.
  await requireActiveAdmin();

  return <DateRangeFilterPlayground />;
};

export default Page;
