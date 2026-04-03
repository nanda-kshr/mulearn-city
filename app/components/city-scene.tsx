"use client";

import dynamic from "next/dynamic";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CityChunk, CityChunkPayload, CityResident } from "@/app/lib/city-types";

const CitySceneCanvas = dynamic(() => import("./city-scene-canvas"), {
  ssr: false,
  loading: () => (
    <div className="city-canvas-loading" role="status" aria-live="polite">
      Rendering 3D city...
    </div>
  ),
});

type CitySceneProps = {
  initialResidents: CityResident[];
  initialPageIndex: number;
  totalPages: number;
  recentDays: number;
  loadDistance: number;
  chunkSize: number;
  perPage: number;
  userLimit: number;
};

type ChunkCoord = {
  x: number;
  z: number;
};

type CameraFocusRequest = {
  id: number;
  muid: string;
};

type CitySearchResponse = {
  resident: CityResident | null;
  error?: string;
};

const KARMA_FORMATTER = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

function chunkKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function spiralIndexFromCoord(x: number, z: number): number {
  if (x === 0 && z === 0) {
    return 0;
  }

  const layer = Math.max(Math.abs(x), Math.abs(z));
  const side = layer * 2;
  const maxValue = (layer * 2 + 1) ** 2 - 1;

  if (z === -layer) {
    return maxValue - (layer - x);
  }

  if (x === -layer) {
    return maxValue - side - (layer + z);
  }

  if (z === layer) {
    return maxValue - side * 2 - (layer + x);
  }

  return maxValue - side * 3 - (layer - z);
}

function chunkCoordToPageIndex(x: number, z: number): number {
  return spiralIndexFromCoord(x, z) + 1;
}

function getChunkCoordsInRadius(center: ChunkCoord, radius: number): ChunkCoord[] {
  const coords: Array<ChunkCoord & { distance: number }> = [];

  for (let dz = -radius; dz <= radius; dz += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      coords.push({
        x: center.x + dx,
        z: center.z + dz,
        distance: Math.abs(dx) + Math.abs(dz),
      });
    }
  }

  return coords
    .sort((left, right) => left.distance - right.distance)
    .map(({ x, z }) => ({ x, z }));
}

function chunkDistanceFrom(center: ChunkCoord, chunk: Pick<ChunkCoord, "x" | "z">): number {
  const dx = Math.abs(chunk.x - center.x);
  const dz = Math.abs(chunk.z - center.z);
  return Math.max(dx, dz);
}

function getAlias(muid: string): string {
  return muid.split("@")[0] ?? muid;
}

function normalizeMuid(input: string): string {
  return input.trim().toLowerCase();
}

export default function CityScene({
  initialResidents,
  initialPageIndex,
  totalPages,
  recentDays,
  loadDistance,
  chunkSize,
  perPage,
  userLimit,
}: CitySceneProps) {
  const [selectedMuid, setSelectedMuid] = useState<string | null>(
    initialResidents[0]?.muid ?? null,
  );
  const [hoveredMuid, setHoveredMuid] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [controlsPaused, setControlsPaused] = useState(false);
  const [playerChunk, setPlayerChunk] = useState<ChunkCoord>({ x: 0, z: 0 });
  const [cameraFocusRequest, setCameraFocusRequest] = useState<CameraFocusRequest | null>(
    null,
  );
  const cameraFocusIdRef = useRef(0);
  const [chunkMap, setChunkMap] = useState<Record<string, CityChunk>>(() => {
    const originKey = chunkKey(0, 0);
    return {
      [originKey]: {
        key: originKey,
        x: 0,
        z: 0,
        pageIndex: initialPageIndex,
        residents: initialResidents,
      },
    };
  });
  const loadingChunksRef = useRef<Set<string>>(new Set());

  const desiredChunkCoords = useMemo(
    () => getChunkCoordsInRadius(playerChunk, loadDistance),
    [playerChunk, loadDistance],
  );

  const loadedChunks = useMemo(() => Object.values(chunkMap), [chunkMap]);
  const residents = useMemo(
    () => loadedChunks.flatMap((chunk) => chunk.residents),
    [loadedChunks],
  );
  const totalKarma = useMemo(
    () => residents.reduce((sum, resident) => sum + resident.karma, 0),
    [residents],
  );

  const focusCameraOnMuid = useCallback((muid: string) => {
    cameraFocusIdRef.current += 1;
    setCameraFocusRequest({
      id: cameraFocusIdRef.current,
      muid,
    });
  }, []);

  const updatePlayerChunk = useCallback((x: number, z: number) => {
    setPlayerChunk((previous) => {
      if (previous.x === x && previous.z === z) {
        return previous;
      }

      return { x, z };
    });
  }, []);

  useEffect(() => {
    setChunkMap((previous) => {
      const keepRadius = loadDistance + 1;
      const maxChunksToKeep = Math.max((keepRadius * 2 + 1) ** 2, 25);
      let changed = false;
      const keptChunks: CityChunk[] = [];

      for (const chunk of Object.values(previous)) {
        if (chunkDistanceFrom(playerChunk, chunk) <= keepRadius) {
          keptChunks.push(chunk);
        } else {
          changed = true;
        }
      }

      if (keptChunks.length > maxChunksToKeep) {
        changed = true;
        keptChunks.sort(
          (left, right) =>
            chunkDistanceFrom(playerChunk, left) - chunkDistanceFrom(playerChunk, right),
        );
        keptChunks.length = maxChunksToKeep;
      }

      const next: Record<string, CityChunk> = {};
      for (const chunk of keptChunks) {
        next[chunk.key] = chunk;
      }

      return changed ? next : previous;
    });
  }, [chunkMap, playerChunk, loadDistance]);

  useEffect(() => {
    for (const coord of desiredChunkCoords) {
      const key = chunkKey(coord.x, coord.z);
      if (chunkMap[key] || loadingChunksRef.current.has(key)) {
        continue;
      }

      const pageIndex = chunkCoordToPageIndex(coord.x, coord.z);
      if (pageIndex > totalPages) {
        continue;
      }

      loadingChunksRef.current.add(key);

      void (async () => {
        try {
          const searchParams = new URLSearchParams({
            pageIndex: String(pageIndex),
            perPage: String(perPage),
            userLimit: String(userLimit),
            recentDays: String(recentDays),
            includeLogs: "0",
          });

          const response = await fetch(`/api/city/chunk?${searchParams.toString()}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json()) as CityChunkPayload;

          setChunkMap((previous) => {
            if (previous[key]) {
              return previous;
            }

            return {
              ...previous,
              [key]: {
                key,
                x: coord.x,
                z: coord.z,
                pageIndex: payload.pageIndex,
                residents: payload.residents,
              },
            };
          });
        } catch {
          // Ignore transient chunk fetch failures; chunk can retry on next range update.
        } finally {
          loadingChunksRef.current.delete(key);
        }
      })();
    }
  }, [chunkMap, desiredChunkCoords, perPage, recentDays, totalPages, userLimit]);

  const loadedInRange = useMemo(
    () =>
      desiredChunkCoords.filter((coord) => {
        const key = chunkKey(coord.x, coord.z);
        if (chunkMap[key]) {
          return true;
        }

        return chunkCoordToPageIndex(coord.x, coord.z) > totalPages;
      }).length,
    [chunkMap, desiredChunkCoords, totalPages],
  );

  const selectedResident = useMemo(() => {
    const current = hoveredMuid ?? selectedMuid;
    if (!current) {
      return residents[0] ?? null;
    }

    return residents.find((resident) => resident.muid === current) ?? residents[0] ?? null;
  }, [hoveredMuid, selectedMuid, residents]);

  const topRecentlyActive = useMemo(
    () =>
      [...residents]
        .sort((left, right) => {
          if (right.recentEvents !== left.recentEvents) {
            return right.recentEvents - left.recentEvents;
          }

          return right.karma - left.karma;
        })
        .slice(0, 6),
    [residents],
  );

  const findResidentInLoadedCity = useCallback(
    (muid: string): CityResident | null => {
      const normalized = normalizeMuid(muid);
      if (normalized.length === 0) {
        return null;
      }

      return residents.find((resident) => normalizeMuid(resident.muid) === normalized) ?? null;
    },
    [residents],
  );

  const injectResidentIntoRandomChunk = useCallback(
    (resident: CityResident): boolean => {
      const eligibleChunks = Object.values(chunkMap).filter(
        (chunk) => chunk.residents.length > 0,
      );
      if (eligibleChunks.length === 0) {
        return false;
      }

      const pickedChunk =
        eligibleChunks[Math.floor(Math.random() * eligibleChunks.length)] ?? null;
      if (!pickedChunk) {
        return false;
      }

      const replaceIndex = Math.floor(Math.random() * pickedChunk.residents.length);

      setChunkMap((previous) => {
        const currentChunk = previous[pickedChunk.key];
        if (!currentChunk || currentChunk.residents.length === 0) {
          return previous;
        }

        const safeIndex = Math.min(replaceIndex, currentChunk.residents.length - 1);
        const nextResidents = [...currentChunk.residents];
        nextResidents[safeIndex] = resident;

        return {
          ...previous,
          [pickedChunk.key]: {
            ...currentChunk,
            residents: nextResidents,
          },
        };
      });

      return true;
    },
    [chunkMap],
  );

  const handleSearchSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isSearching) {
        return;
      }

      const query = searchInput.trim();
      if (query.length === 0) {
        setSearchFeedback("Enter a MUID to search.");
        return;
      }

      setIsSearching(true);
      setSearchFeedback("Searching city...");

      try {
        const loadedResident = findResidentInLoadedCity(query);
        if (loadedResident) {
          setSelectedMuid(loadedResident.muid);
          setSearchFeedback(`Found ${loadedResident.muid}. Flying camera...`);
          focusCameraOnMuid(loadedResident.muid);
          return;
        }

        const searchParams = new URLSearchParams({
          muid: query,
          recentDays: String(recentDays),
        });
        const response = await fetch(`/api/city/search?${searchParams.toString()}`, {
          cache: "no-store",
        });

        const payload = (await response.json()) as CitySearchResponse;
        const resident = payload.resident;
        if (!response.ok || !resident) {
          setSearchFeedback(payload.error ?? "No matching MUID found.");
          return;
        }

        const inserted = injectResidentIntoRandomChunk(resident);
        if (!inserted) {
          setSearchFeedback("No rendered buildings available to replace right now.");
          return;
        }

        setSelectedMuid(resident.muid);
        setSearchFeedback(`Injected ${resident.muid} into city. Flying camera...`);
        focusCameraOnMuid(resident.muid);
      } catch {
        setSearchFeedback("Search failed. Please try again.");
      } finally {
        setIsSearching(false);
      }
    },
    [
      findResidentInLoadedCity,
      focusCameraOnMuid,
      injectResidentIntoRandomChunk,
      isSearching,
      recentDays,
      searchInput,
    ],
  );

  const handleCameraFocusComplete = useCallback((muid: string) => {
    setSearchFeedback(`Camera focused on ${muid}.`);
  }, []);

  return (
    <section className="city-stage" aria-label="3D city view">
      <div className={`city-canvas-shell${isFocused ? " is-focused" : ""}`}>
        <CitySceneCanvas
          chunks={loadedChunks}
          chunkSize={chunkSize}
          selectedMuid={selectedMuid}
          controlsPaused={controlsPaused}
          cameraFocusRequest={cameraFocusRequest}
          onSelect={setSelectedMuid}
          onHover={setHoveredMuid}
          onFocusChange={setIsFocused}
          onPlayerChunkChange={updatePlayerChunk}
          onCameraFocusComplete={handleCameraFocusComplete}
        />

        <form className="city-search city-search-overlay" onSubmit={handleSearchSubmit}>
          <label className="city-search-label" htmlFor="city-search-muid">
            Search MUID
          </label>
          <div className="city-search-row">
            <input
              id="city-search-muid"
              className="city-search-input"
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onFocus={() => setControlsPaused(true)}
              onBlur={() => setControlsPaused(false)}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
              placeholder="eg: someone@mulearn"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="city-search-button"
              disabled={isSearching}
            >
              {isSearching ? "Searching" : "Search"}
            </button>
          </div>
          {searchFeedback ? (
            <p className="city-search-feedback" role="status" aria-live="polite">
              {searchFeedback}
            </p>
          ) : null}
        </form>

        <div className="city-overlay-hud" aria-hidden>
          <p className="city-overlay-title">muLearn City</p>
          <p className="city-overlay-meta">
            Loaded residents {residents.length} - Karma {KARMA_FORMATTER.format(totalKarma)}
          </p>
          <p className="city-overlay-meta">
            Chunk {playerChunk.x},{playerChunk.z} - Loaded {loadedInRange}/{desiredChunkCoords.length} nearby pages
          </p>
        </div>

        <aside className="city-inspector city-inspector-overlay">
          <p className="city-inspector-hint">
            {isFocused
              ? "First-person mode: WASD move, Space up, Control down, mouse look. Esc or click releases cursor."
              : "Click the city to focus controls. Click again to release cursor."}
          </p>

          {selectedResident ? (
            <section className="city-inspector-card" aria-live="polite">
              <p className="city-inspector-kicker">Selected building</p>
              <h2>{selectedResident.name}</h2>
              <p className="city-inspector-muid">@{getAlias(selectedResident.muid)}</p>

              <dl className="city-inspector-data">
                <div>
                  <dt>Karma</dt>
                  <dd>{selectedResident.karmaLabel}</dd>
                </div>
                <div>
                  <dt>Recent events</dt>
                  <dd>{selectedResident.recentEvents}</dd>
                </div>
                <div>
                  <dt>Organization</dt>
                  <dd>{selectedResident.organization}</dd>
                </div>
                <div>
                  <dt>Interest</dt>
                  <dd>{selectedResident.interest}</dd>
                </div>
                <div>
                  <dt>Last active</dt>
                  <dd>{selectedResident.lastActiveLabel}</dd>
                </div>
              </dl>

              <p className="city-inspector-task" title={selectedResident.latestTask}>
                Latest task: {selectedResident.latestTask}
              </p>
            </section>
          ) : null}

          <section className="city-legend">
            <h3>Visual legend</h3>
            <p>Tower height scales with total karma.</p>
            <p>Glow intensity scales with activity in the last {recentDays} days.</p>
            <p>Color is derived from each member&apos;s domain signature.</p>
          </section>

          <section className="city-hot">
            <h3>Most active now</h3>
            <ul className="city-hot-list">
              {topRecentlyActive.map((resident) => {
                const selected = resident.muid === selectedMuid;
                return (
                  <li key={resident.muid}>
                    <button
                      type="button"
                      className={`city-hot-button${selected ? " is-selected" : ""}`}
                      onClick={() => setSelectedMuid(resident.muid)}
                    >
                      <span>{resident.name}</span>
                      <span>{resident.recentEvents} evt</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}
