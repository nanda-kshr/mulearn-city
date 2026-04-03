import CityScene from "@/app/components/city-scene";
import {
  CITY_CHUNK_SIZE,
  CITY_LOAD_DISTANCE,
  CITY_PER_PAGE,
  CITY_RECENT_DAYS,
  CITY_USER_LIMIT,
  fetchCityPage,
} from "@/app/lib/city-data";

export default async function Home() {
  const initialChunk = await fetchCityPage(1, {
    perPage: CITY_PER_PAGE,
    userLimit: CITY_USER_LIMIT,
    recentDays: CITY_RECENT_DAYS,
    cache: "no-store",
  });
  const residents = initialChunk.residents;

  return (
    <div className="city-page">
      <div className="city-noise" aria-hidden />
      <main className="city-shell city-shell-fullscreen">
        {residents.length === 0 ? (
          <section className="city-empty" aria-live="polite">
            <h2>No residents were loaded</h2>
            <p>
              Check API reachability or update the environment variables in
              <code>.env.local</code>.
            </p>
          </section>
        ) : (
          <CityScene
            initialResidents={residents}
            initialPageIndex={initialChunk.pageIndex}
            totalPages={initialChunk.totalPages}
            recentDays={CITY_RECENT_DAYS}
            loadDistance={CITY_LOAD_DISTANCE}
            chunkSize={CITY_CHUNK_SIZE}
            perPage={CITY_PER_PAGE}
            userLimit={CITY_USER_LIMIT}
          />
        )}
      </main>
    </div>
  );
}
