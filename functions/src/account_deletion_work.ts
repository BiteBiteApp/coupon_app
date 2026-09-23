import {milestoneLockToken} from "./rating_dish_delete_job.js";
import {createHash} from "node:crypto";
import type {AccountDeletionStepContext} from "./account_deletion_service.js";
import {parseRatingDestructiveJobDocument, parseRatingDestructiveJobItemDocument, ratingDestructiveJobPath, ratingDestructiveJobItemPath} from "./rating_destructive_job_contract.js";
import {parseDishProposalJobDocument} from "./dish_proposal_resolution_jobs.js";
import {parseDishReviewAggregateWinnerDocument, createDishReviewAggregateReviewerFingerprint} from "./dish_review_aggregate_accumulator.js";
import {parseCompletedDeletionMilestoneManifest} from "./contribution_points_helpers.js";

const stored = (snapshot: FirebaseFirestore.DocumentSnapshot) => snapshot.exists ? {id: snapshot.id, data: snapshot.data()!, createTime: snapshot.createTime?.toDate() ?? null} : null;
/** Delete only terminal, strictly parsed evidence. Unknown namespaces and active
 * operations remain visible as accepted work, never treated as orphaned. */
export async function accountDeletionSettledWorkStep(context: AccountDeletionStepContext): Promise<boolean> {
  const {db, job} = context;
  const items = await db.collection("private_rating_destructive_job_items").where("userId", "==", job.uid).limit(1).get();
  if (!items.empty) {
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(items.docs[0].ref);
      const item = parseRatingDestructiveJobItemDocument(stored(current));
      if (!item || item.userId !== job.uid || item.kind !== "milestoneUser" || item.status !== "complete" || item.subphase !== "complete") throw new Error("Milestone work is not terminal");
      const parent = parseRatingDestructiveJobDocument(stored(await tx.get(db.doc(ratingDestructiveJobPath(item.jobId)))));
      if (!parent || parent.status !== "complete") throw new Error("Parent work is not terminal");
      const manifestRef = db.doc(`private_review_milestone_count_accumulators/${item.itemId}`);
      const manifest = await tx.get(manifestRef);
      if (manifest.exists) {
        const value = parseCompletedDeletionMilestoneManifest(manifest, {userId: job.uid, operationId: item.jobId, namespaceId: item.itemId, lockToken: milestoneLockToken(item.jobId, item.itemId, job.uid), scanId: item.itemId});
        const fingerprint = createHash("sha256").update(JSON.stringify(["bitestar.review-milestone-accumulator.v2", ["userId", job.uid]])).digest("hex");
        if (value.userFingerprint !== fingerprint || value.state !== "count-complete" || value.reconciliationPhase !== "complete") throw new Error("Accumulator not terminal");
        const children = await tx.get(manifestRef.collection("seen_valid_identities").limit(1));
        if (!children.empty) { tx.delete(children.docs[0].ref); return; }
        tx.delete(manifestRef);
      }
      tx.delete(current.ref);
    });
    return false;
  }
  const winners = await db.collectionGroup("aggregate_winners").where("reviewerFingerprint", "==", createDishReviewAggregateReviewerFingerprint(job.uid)).limit(1).get();
  if (!winners.empty) {
    await db.runTransaction(async (tx) => {
      await context.assertLease(tx);
      const current = await tx.get(winners.docs[0].ref);
      const winner = parseDishReviewAggregateWinnerDocument(stored(current));
      if (!winner || winner.reviewerFingerprint !== createDishReviewAggregateReviewerFingerprint(job.uid)) throw new Error("Winner identity changed");
      const [root, namespace, child, id] = current.ref.path.split("/");
      if (!id || child !== "aggregate_winners" || winner.jobId !== namespace) throw new Error("Winner namespace invalid");
      if (root === "private_dish_edit_application_jobs") {
        const parent = parseDishProposalJobDocument(stored(await tx.get(db.doc(`${root}/${namespace}`))));
        if (!parent || parent.status !== "complete") throw new Error("Proposal accounting is active");
      } else if (root === "private_rating_destructive_job_items") {
        const item = parseRatingDestructiveJobItemDocument(stored(await tx.get(db.doc(ratingDestructiveJobItemPath(namespace)))));
        if (item && item.status !== "complete") throw new Error("Rating accounting item is active");
        const parent = parseRatingDestructiveJobDocument(stored(await tx.get(db.doc(ratingDestructiveJobPath(item?.jobId ?? namespace)))));
        if (!parent || parent.status !== "complete") throw new Error("Rating accounting is active");
      } else throw new Error("Unknown winner namespace");
      tx.delete(current.ref);
    });
    return false;
  }
  return true;
}
