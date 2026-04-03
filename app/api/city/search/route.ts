import { NextResponse } from "next/server";
import { CITY_RECENT_DAYS, fetchCityResidentByMuid } from "@/app/lib/city-data";

function parseIntParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const muid = (searchParams.get("muid") ?? "").trim();
  const recentDays = parseIntParam(
    searchParams.get("recentDays"),
    CITY_RECENT_DAYS,
    1,
    365,
  );

  if (muid.length === 0) {
    return NextResponse.json(
      {
        resident: null,
        error: "muid is required",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const resident = await fetchCityResidentByMuid(muid, {
    recentDays,
    cache: "no-store",
  });

  return NextResponse.json(
    {
      resident,
    },
    {
      status: resident ? 200 : 404,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
