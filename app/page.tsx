import TripForm from "@/components/TripForm";
import RecentItineraries from "@/components/RecentItineraries";
import countriesData from "@/data/countries.json";

export default function Home() {
  const countries = Array.isArray(countriesData)
    ? countriesData.map((c) => ({ code: c.code, name: c.name, nameKo: c.nameKo }))
    : [];

  return (
    <main className="min-h-screen bg-grid px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="bg-gradient-to-r from-slate-900 via-violet-700 to-sky-700 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
          맞춤 여행 플래너
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          목적지와 스타일을 입력하면 AI가 날짜별 일정을 만들어 드려요.
        </p>
      </div>
      <div className="mx-auto mt-12 max-w-xl">
        <TripForm initialCountries={countries} />
      </div>
      <RecentItineraries />
    </main>
  );
}
