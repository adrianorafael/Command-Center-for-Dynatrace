/**
 * App function `delivery-report` — called by the engine workflow's `report` task with
 * `{ results: DeliveryResult[] }` gathered from the send_* tasks.
 */

import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { runDeliveryReport, type DeliveryReportResponse } from "./lib/delivery";

export default async function (payload: unknown = undefined): Promise<DeliveryReportResponse> {
  return runDeliveryReport(payload, { repo: new AppStateRepository() });
}
