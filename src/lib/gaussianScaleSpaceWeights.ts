/**
 * Weights to apply to the different gaussaian
 * scales based on the half size of their kernel
 * (hKernel)
 */
export type GaussianScaleSpaceWeights = {
  hKernel60: number;
  hKernel30: number;
  hKernel15: number;
  hKernel7: number;
  hKernel3: number;
};

export type GaussianScaleSpaceWeightsPerZoomLevel = Record<number, GaussianScaleSpaceWeights>;

export const defaultGaussianScaleSpaceWeights: GaussianScaleSpaceWeightsPerZoomLevel = {
  2: {
    hKernel60: 0.08,
    hKernel30: 0.08,
    hKernel15: 0.12,
    hKernel7: 0.05,
    hKernel3: 0.1,
  },

  3: {
    hKernel60: 0.1,
    hKernel30: 0.1,
    hKernel15: 0.09,
    hKernel7: 0.05,
    hKernel3: 0.1,
  },

  4: {
    hKernel60: 0.1,
    hKernel30: 0.1,
    hKernel15: 0.07,
    hKernel7: 0.05,
    hKernel3: 0.1,
  },

  5: {
    hKernel60: 0.1,
    hKernel30: 0.1,
    hKernel15: 0.1,
    hKernel7: 0.1,
    hKernel3: 0.2,
  },

  6: {
    hKernel60: 0.1,
    hKernel30: 0.2,
    hKernel15: 0.1,
    hKernel7: 0.2,
    hKernel3: 0.3,
  },

  7: {
    hKernel60: 0.2,
    hKernel30: 0.15,
    hKernel15: 0.2,
    hKernel7: 0.5,
    hKernel3: 0.5,
  },

  8: {
    hKernel60: 0.5,
    hKernel30: 0.1,
    hKernel15: 0.1,
    hKernel7: 1,
    hKernel3: 2,
  },

  9: {
    hKernel60: 0.3,
    hKernel30: 0.5,
    hKernel15: 1,
    hKernel7: 2,
    hKernel3: 3,
  },

  10: {
    hKernel60: 0.75,
    hKernel30: 0.75,
    hKernel15: 3,
    hKernel7: 3,
    hKernel3: 4,
  },

  11: {
    hKernel60: 2,
    hKernel30: 2,
    hKernel15: 3,
    hKernel7: 3,
    hKernel3: 4,
  },

  12: {
    hKernel60: 6,
    hKernel30: 3,
    hKernel15: 3,
    hKernel7: 10,
    hKernel3: 12,
  },

  13: {
    hKernel60: 8,
    hKernel30: 7,
    hKernel15: 10,
    hKernel7: 10,
    hKernel3: 15,
  },

  14: {
    hKernel60: 15,
    hKernel30: 8,
    hKernel15: 6,
    hKernel7: 12,
    hKernel3: 12,
  },

  15: {   
    hKernel60: 30,
    hKernel30: 16,
    hKernel15: 10,
    hKernel7: 18,
    hKernel3: 20,
  },

  16: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },

  // same as 16
  17: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },

  // same as 16
  18: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },

  // same as 16
  19: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },

  // same as 16
  20: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },

  // same as 16
  21: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },

  // same as 16
  22: {
    hKernel60: 30,
    hKernel30: 25,
    hKernel15: 25,
    hKernel7: 18,
    hKernel3: 20,
  },
} as const;
