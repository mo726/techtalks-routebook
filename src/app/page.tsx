
type Visit = {
  id: number;
  customerName: string;
  visitOrder: number;
  status: "Pending" | "Completed";
};

type StockItem = {
  id: number;
  name: string;
  quantity: number;
  unit: string;
};

// Mock data
const visits: Visit[] = [
  {
    id: 1,
    customerName: "Cedar Market",
    visitOrder: 1,
    status: "Pending",
  },
  {
    id: 2,
    customerName: "Fresh Market",
    visitOrder: 2,
    status: "Pending",
  },
  {
    id: 3,
    customerName: "City Shop",
    visitOrder: 3,
    status: "Pending",
  },
];

const stockItems: StockItem[] = [
  {
    id: 1,
    name: "Water Bottle",
    quantity: 100,
    unit: "Bottles",
  },
  {
    id: 2,
    name: "Orange Juice",
    quantity: 40,
    unit: "Bottles",
  },
  {
    id: 3,
    name: "Apple Juice",
    quantity: 25,
    unit: "Bottles",
  },
];

export default function Home() {
  const totalStock = stockItems.reduce(
    (total, item) => total + item.quantity,
    0
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              RouteBook
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Driver Dashboard
            </p>
          </div>

          <span className="rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">
            Driver
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900">
            Welcome, Driver
          </h2>
          <p className="mt-2 text-slate-500">
            View your assigned customer visits and available van stock.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {/* Assigned Visits */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Today's Visits
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Your assigned customer visits
                </p>
              </div>

              <span className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                {visits.length} Visits
              </span>
            </div>

            <div className="space-y-4">
              {visits.map((visit) => (
                <div
                  key={visit.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700">
                      {visit.visitOrder}
                    </div>

                    <div>
                      <h4 className="font-semibold text-slate-900">
                        {visit.customerName}
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        Visit #{visit.visitOrder}
                      </p>
                    </div>
                  </div>

                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    {visit.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Van Stock */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Van Stock
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Available products in your van
                </p>
              </div>

              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                {totalStock} Units
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-sm text-slate-500">
                    <th className="pb-3 font-medium">Product</th>
                    <th className="pb-3 text-right font-medium">
                      Available
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {stockItems.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="py-4 font-medium text-slate-800">
                        {item.name}
                      </td>
                      <td className="py-4 text-right">
                        <span className="font-semibold text-slate-900">
                          {item.quantity}
                        </span>
                        <span className="ml-2 text-sm text-slate-500">
                          {item.unit}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
