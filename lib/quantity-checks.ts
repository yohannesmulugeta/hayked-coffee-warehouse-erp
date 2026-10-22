import { createSupabaseClient } from "./supabase/client";

export type QuantityStage = "ARRIVAL" | "PROCESSING_INTAKE" | "PROCESSING_OUTPUT" | "DISPATCH_EXIT";
export type QuantityCheck = {
  id: string;
  stage: QuantityStage;
  reference_id: string;
  expected_kg: number;
  expected_bags: number;
  measured_kg: number;
  measured_bags: number;
  evidence_reference: string;
  difference_reason: string | null;
  payload: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "REJECTED";
  recorded_by: string;
  verified_by: string | null;
  decision_note: string | null;
};

export async function loadQuantityCheck(stage: QuantityStage, referenceId: string) {
  const { data, error } = await createSupabaseClient().from("quantity_checks")
    .select("id,stage,reference_id,expected_kg,expected_bags,measured_kg,measured_bags,evidence_reference,difference_reason,payload,status,recorded_by,verified_by,decision_note")
    .eq("stage", stage).eq("reference_id", referenceId)
    .order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as QuantityCheck | null;
}

export async function submitQuantityCheck(input: {
  stage: QuantityStage; referenceId: string; expectedKg?: number | null; expectedBags?: number | null;
  measuredKg: number; measuredBags: number; evidenceReference: string;
  differenceReason?: string; payload?: Record<string, unknown>;
}) {
  const { data, error } = await createSupabaseClient().rpc("submit_quantity_check", {
    p_stage: input.stage, p_reference_id: input.referenceId,
    p_expected_kg: input.expectedKg ?? null, p_expected_bags: input.expectedBags ?? null,
    p_measured_kg: input.measuredKg, p_measured_bags: input.measuredBags,
    p_evidence_reference: input.evidenceReference,
    p_difference_reason: input.differenceReason?.trim() || null,
    p_payload: input.payload ?? {},
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function decideQuantityCheck(id: string, decision: "APPROVED" | "REJECTED", note: string) {
  const { data, error } = await createSupabaseClient().rpc("decide_quantity_check", {
    p_check_id: id, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; status: string; operation: { status?: string } };
}

export async function cancelQueuedProcessingOrder(id: string, reason: string) {
  const { error } = await createSupabaseClient().rpc("cancel_queued_processing_order", {
    p_order_id: id, p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function cancelUnpostedDispatch(id: string, reason: string) {
  const { error } = await createSupabaseClient().rpc("cancel_dispatch", {
    p_dispatch_id: id, p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export type TransformJob = {
  id: string; job_type: "REBAG" | "BLEND"; client_id: string; coffee_type: string;
  input_kg: number; input_bags: number; output_kg: number; output_bags: number;
  output_section: string; evidence_reference: string; instruction: string;
  status: "PENDING" | "POSTED" | "REJECTED"; output_lot_id: string | null;
  recorded_by: string; approved_by: string | null; decision_note: string | null;
  created_at: string;
};
export type TransformSource = { job_id: string; lot_id: string; input_bags: number; input_kg: number };

export async function loadTransformJobs() {
  const db = createSupabaseClient();
  const [jobs, sources] = await Promise.all([
    db.from("coffee_transform_jobs").select("id,job_type,client_id,coffee_type,input_kg,input_bags,output_kg,output_bags,output_section,evidence_reference,instruction,status,output_lot_id,recorded_by,approved_by,decision_note,created_at").order("created_at", { ascending: false }),
    db.from("coffee_transform_sources").select("job_id,lot_id,input_bags,input_kg"),
  ]);
  if (jobs.error || sources.error) throw new Error(jobs.error?.message ?? sources.error?.message);
  return { jobs: jobs.data as TransformJob[], sources: sources.data as TransformSource[] };
}

export async function submitTransformJob(input: {
  type: "REBAG" | "BLEND"; clientId: string;
  sources: { lotId: string; bags: number; kg: number }[];
  outputBags: number; outputKg: number; section: string;
  evidenceReference: string; instruction: string;
}) {
  const { data, error } = await createSupabaseClient().rpc("submit_coffee_transform", {
    p_job_type: input.type, p_client_id: input.clientId, p_sources: input.sources,
    p_output_bags: input.outputBags, p_output_kg: input.outputKg,
    p_output_section: input.section, p_evidence_reference: input.evidenceReference,
    p_instruction: input.instruction,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function decideTransformJob(id: string, decision: "APPROVED" | "REJECTED", note: string) {
  const { data, error } = await createSupabaseClient().rpc("decide_coffee_transform", {
    p_job_id: id, p_decision: decision, p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; status: string; output_lot_id: string | null };
}

export async function loadPendingOperationalReviews() {
  const db = createSupabaseClient();
  const [checkResult, jobResult] = await Promise.all([
    db.from("quantity_checks")
      .select("id,stage,reference_id,client_id,expected_kg,measured_kg,expected_bags,measured_bags,evidence_reference,difference_reason,payload,recorded_by,recorded_at")
      .eq("status", "PENDING").order("recorded_at", { ascending: true }),
    db.from("coffee_transform_jobs")
      .select("id,job_type,client_id,input_kg,output_kg,input_bags,output_bags,output_section,evidence_reference,instruction,recorded_by,created_at")
      .eq("status", "PENDING").order("created_at", { ascending: true }),
  ]);
  if (checkResult.error || jobResult.error) throw new Error(checkResult.error?.message ?? jobResult.error?.message);
  const jobs = jobResult.data ?? [];
  const sourcesResult = jobs.length
    ? await db.from("coffee_transform_sources").select("job_id,lot_id,input_bags,input_kg").in("job_id", jobs.map((job) => job.id))
    : { data: [], error: null };
  if (sourcesResult.error) throw new Error(sourcesResult.error.message);
  const sources = sourcesResult.data ?? [];
  const lotsResult = sources.length
    ? await db.from("coffee_lots").select("id,lot_number").in("id", sources.map((source) => source.lot_id))
    : { data: [], error: null };
  if (lotsResult.error) throw new Error(lotsResult.error.message);
  const checks = checkResult.data ?? [];
  const clientIds = [...new Set([...checks.map((item) => item.client_id), ...jobs.map((item) => item.client_id)])];
  const references = (stages: string[]) => checks.filter((item) => stages.includes(item.stage)).map((item) => item.reference_id);
  const [clientsResult, receiptsResult, ordersResult, dispatchesResult] = await Promise.all([
    clientIds.length ? db.from("clients").select("id,legal_name").in("id", clientIds) : Promise.resolve({ data: [], error: null }),
    references(["ARRIVAL"]).length ? db.from("warehouse_receipts").select("id,receipt_number").in("id", references(["ARRIVAL"])) : Promise.resolve({ data: [], error: null }),
    references(["PROCESSING_INTAKE", "PROCESSING_OUTPUT"]).length ? db.from("processing_orders").select("id,order_number").in("id", references(["PROCESSING_INTAKE", "PROCESSING_OUTPUT"])) : Promise.resolve({ data: [], error: null }),
    references(["DISPATCH_EXIT"]).length ? db.from("dispatch_orders").select("id,dispatch_number").in("id", references(["DISPATCH_EXIT"])) : Promise.resolve({ data: [], error: null }),
  ]);
  const detailError = [clientsResult, receiptsResult, ordersResult, dispatchesResult].find((item) => item.error)?.error;
  if (detailError) throw new Error(detailError.message);
  return { checks, jobs, sources, lots: lotsResult.data ?? [], clients: clientsResult.data ?? [], receipts: receiptsResult.data ?? [], orders: ordersResult.data ?? [], dispatches: dispatchesResult.data ?? [] };
}

export async function loadLotTrace(lotId: string) {
  const db = createSupabaseClient();
  const [movementResult, inputResult, outputResult, transformSourceResult, transformOutputResult] = await Promise.all([
    db.from("stock_movements").select("id,movement_type,quantity_kg,bag_delta,reference_type,reference_id,reason,occurred_at").eq("lot_id", lotId).order("occurred_at"),
    db.from("processing_order_inputs").select("id,order_id,input_kg,input_bags").eq("lot_id", lotId),
    db.from("processing_outputs").select("id,order_id,category,quantity_kg,bag_count,child_lot_id").eq("child_lot_id", lotId),
    db.from("coffee_transform_sources").select("job_id,input_kg,input_bags").eq("lot_id", lotId),
    db.from("coffee_transform_jobs").select("id,job_type,output_lot_id,input_kg,output_kg,input_bags,output_bags,evidence_reference,status").eq("output_lot_id", lotId),
  ]);
  const firstError = [movementResult, inputResult, outputResult, transformSourceResult, transformOutputResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);
  const movements = movementResult.data ?? [];
  const inputs = inputResult.data ?? [];
  const outputs = outputResult.data ?? [];
  const transformSources = transformSourceResult.data ?? [];
  const incomingTransforms = transformOutputResult.data ?? [];
  const orderIds = [...new Set([...inputs, ...outputs].map((item) => item.order_id))];
  const transformIds = [...new Set([
    ...transformSources.map((item) => item.job_id),
    ...incomingTransforms.map((item) => item.id),
  ])];
  const [linkedOutputs, linkedInputs, linkedTransforms, linkedTransformSources] = await Promise.all([
    orderIds.length ? db.from("processing_outputs").select("order_id,category,quantity_kg,bag_count,child_lot_id").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? db.from("processing_order_inputs").select("order_id,lot_id,input_kg,input_bags").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    transformIds.length ? db.from("coffee_transform_jobs").select("id,job_type,output_lot_id,input_kg,output_kg,input_bags,output_bags,evidence_reference,status").in("id", transformIds) : Promise.resolve({ data: [], error: null }),
    transformIds.length ? db.from("coffee_transform_sources").select("job_id,lot_id,input_kg,input_bags").in("job_id", transformIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const linkedError = [linkedOutputs, linkedInputs, linkedTransforms, linkedTransformSources].find((result) => result.error)?.error;
  if (linkedError) throw new Error(linkedError.message);
  const relatedLotIds = [...new Set([
    lotId,
    ...(linkedOutputs.data ?? []).map((item) => item.child_lot_id).filter((id): id is string => Boolean(id)),
    ...(linkedInputs.data ?? []).map((item) => item.lot_id),
    ...(linkedTransforms.data ?? []).map((item) => item.output_lot_id).filter((id): id is string => Boolean(id)),
    ...(linkedTransformSources.data ?? []).map((item) => item.lot_id),
  ])];
  const referenceIds = [...new Set(movements.map((item) => item.reference_id))];
  const [lotsResult, checksResult, ordersResult] = await Promise.all([
    db.from("coffee_lots").select("id,lot_number,section,quantity_kg,bag_count").in("id", relatedLotIds),
    referenceIds.length ? db.from("quantity_checks").select("stage,reference_id,expected_kg,measured_kg,expected_bags,measured_bags,evidence_reference,difference_reason,status,verified_by").in("reference_id", referenceIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? db.from("processing_orders").select("id,order_number").in("id", orderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (lotsResult.error || checksResult.error || ordersResult.error) throw new Error(lotsResult.error?.message ?? checksResult.error?.message ?? ordersResult.error?.message);
  return {
    movements,
    inputs: linkedInputs.data ?? [], outputs: linkedOutputs.data ?? [],
    transforms: linkedTransforms.data ?? [], transformSources: linkedTransformSources.data ?? [],
    lots: lotsResult.data ?? [], checks: checksResult.data ?? [], orders: ordersResult.data ?? [],
  };
}
