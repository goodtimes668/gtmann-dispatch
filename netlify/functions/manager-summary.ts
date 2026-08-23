import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { handleError, HttpError, json } from "./_shared/http";
import { listBookings } from "./_shared/stores";
import { isISODate } from "./_shared/validation";

export default async (req: Request, _context: Context) => {
  try {
    await requireUser(["manager"]);
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    if ((from && !isISODate(from)) || (to && !isISODate(to)) || (from && to && from > to)) {
      throw new HttpError(422, "Invalid date range");
    }
    const bookings = (await listBookings()).filter((booking) => (!from || booking.date >= from) && (!to || booking.date <= to));
    const sites: Record<string, { count: number; cost: number; actualCost: number; actualMinutes: number; actualKm: number; declined: number }> = {};
    for (const booking of bookings) {
      const key = booking.site || "(No Site)";
      sites[key] ||= { count: 0, cost: 0, actualCost: 0, actualMinutes: 0, actualKm: 0, declined: 0 };
      sites[key].count += 1;
      if (booking.status === "declined") sites[key].declined += 1;
      else {
        sites[key].cost += booking.estCost;
        sites[key].actualCost += booking.actualCost || 0;
        sites[key].actualMinutes += booking.actualMinutes || 0;
        sites[key].actualKm += booking.actualKm || 0;
      }
    }
    const bySite = Object.entries(sites)
      .map(([name, value]) => ({ name, ...value, cost: Math.round(value.cost * 100) / 100 }))
      .sort((a, b) => b.cost - a.cost);
    return json({
      bookings: bookings.length,
      cost: Math.round(bySite.reduce((sum, site) => sum + site.cost, 0) * 100) / 100,
      actualCost: Math.round(bySite.reduce((sum, site) => sum + site.actualCost, 0) * 100) / 100,
      actualMinutes: bySite.reduce((sum, site) => sum + site.actualMinutes, 0),
      actualKm: Math.round(bySite.reduce((sum, site) => sum + site.actualKm, 0) * 10) / 10,
      declined: bySite.reduce((sum, site) => sum + site.declined, 0),
      bySite,
    });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/manager-summary" };
