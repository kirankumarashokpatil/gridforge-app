import { SP_DURATION_H } from "../shared/constants.js";

/**
 * imbalanceMw = actualPhysicalMw − (contractedMw + bmAcceptedMw)
 * Positive = Surplus (Paid SSP); Negative = Shortage (Pays SBP)
 */
export function computeImbalance(actualPhysicalMw, contractedMw, bmAcceptedMw = 0) {
  return actualPhysicalMw - (contractedMw + (bmAcceptedMw || 0));
}

export function selectImbalancePrice(imbalanceMw, sbp, ssp) {
  return imbalanceMw < 0 ? sbp : ssp;
}

export function computeImbalanceSettlement({
  actualPhysicalMw,
  contractedMw,
  bmAcceptedMw = 0,
  sbp,
  ssp,
  spDurationH = SP_DURATION_H,
}) {
  const imbalanceMw = computeImbalance(actualPhysicalMw, contractedMw, bmAcceptedMw);
  const price = selectImbalancePrice(imbalanceMw, sbp, ssp);
  const mwh = imbalanceMw * spDurationH;
  const cash = mwh * price;

  return {
    imbalanceMw,
    price,
    mwh,
    cash,
  };
}

export function computeHubFeeFromSettlements(settlements) {
  const sumPlayerImbCash = settlements.reduce((acc, s) => acc + (s.imbCash || 0), 0);
  return { sumPlayerImbCash, hubFee: -sumPlayerImbCash };
}

