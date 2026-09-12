"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  customerBiteSaverAvailabilityLocalPartsForTesting,
  customerBiteSaverFreshLocationMaximumAgeMilliseconds,
  customerBiteSaverRedemptionTimerMilliseconds,
  evaluateCustomerBiteSaverOfferAvailability,
} = require("../lib/customer_bitesaver_offer_availability.js");
const {
  exactCustomerBiteSaverDistanceMiles,
} = require("../lib/restaurant_geo_helpers.js");

const newYork = "America/New_York";
const restaurantCoordinates = {latitude: 28.5383, longitude: -81.3792};

function usage(overrides = {}) {
  return {
    known: true,
    lastRedeemedAt: null,
    timerStartedAt: null,
    generation: "usage-generation-1",
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    offerType: "coupon",
    offer: {isActive: true, active: true, usageRule: "Unlimited"},
    parentEligible: true,
    now: new Date("2026-01-15T17:00:00.000Z"),
    timeZone: newYork,
    locationMode: "current",
    restaurantCoordinates,
    currentCoordinates: restaurantCoordinates,
    currentCoordinatesCapturedAt: new Date("2026-01-15T16:59:00.000Z"),
    usage: usage(),
    requireFreshLocation: false,
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateCustomerBiteSaverOfferAvailability(input(overrides));
}

function assertUnavailable(decision, reason, usageState = "available") {
  assert.deepEqual(decision, {
    visible: false,
    redeemable: false,
    reason,
    usageState,
    activeTimerExpiresAtMs: null,
    nextAvailableAtMs: null,
    proximityDistanceMiles: null,
    eligibilityExpiresAtMs: null,
  });
  assert.equal(Object.isFrozen(decision), true);
}

function assertAvailableUntil(decision, eligibilityExpiresAtMs) {
  assert.deepEqual(decision, {
    visible: true,
    redeemable: true,
    reason: "available",
    usageState: "available",
    activeTimerExpiresAtMs: null,
    nextAvailableAtMs: null,
    proximityDistanceMiles: null,
    eligibilityExpiresAtMs,
  });
  assert.equal(Object.isFrozen(decision), true);
}

test("parent eligibility and explicit inactive flags fail closed", () => {
  assertUnavailable(evaluate({parentEligible: false}), "parentUnavailable");
  assertUnavailable(
    evaluate({offer: {isActive: false, usageRule: "Unlimited"}}),
    "inactive",
  );
  assertUnavailable(
    evaluate({offer: {active: false, usageRule: "Unlimited"}}),
    "inactive",
  );
  assertUnavailable(
    evaluate({
      offerType: "dailySpecial",
      offer: {isActive: false, createdAt: input().now},
    }),
    "inactive",
  );
  for (const isActive of [0, " FALSE "]) {
    assertUnavailable(
      evaluate({
        offerType: "dailySpecial",
        offer: {isActive, createdAt: input().now},
      }),
      "inactive",
    );
  }
  for (const isActive of [1, -1, Number.NaN, " TRUE ", "malformed"]) {
    assert.equal(
      evaluate({
        offerType: "dailySpecial",
        offer: {isActive, createdAt: input().now},
      }).reason,
      "available",
    );
  }
  assert.equal(evaluate({offer: {usageRule: "Unlimited"}}).reason, "available");
  assert.equal(
    evaluate({
      offerType: "dailySpecial",
      offer: {active: false, createdAt: input().now},
    }).reason,
    "available",
  );
});

test("coupon start and expiration boundaries are inclusive", () => {
  const now = new Date("2026-01-15T17:00:00.000Z");
  assert.equal(
    evaluate({
      now,
      offer: {
        startTime: now,
        endTime: now,
        usageRule: "Unlimited",
      },
    }).reason,
    "available",
  );
  assertUnavailable(
    evaluate({
      now: new Date(now.getTime() - 1),
      offer: {startTime: now, usageRule: "Unlimited"},
    }),
    "notStarted",
  );
  assertUnavailable(
    evaluate({
      now: new Date(now.getTime() + 1),
      offer: {endTime: now, usageRule: "Unlimited"},
    }),
    "expired",
  );
  assertUnavailable(
    evaluate({
      now: new Date(now.getTime() + 1),
      offer: {expires: now.toISOString(), usageRule: "Unlimited"},
    }),
    "expired",
  );
  const legacyFallbackAtBoundary = evaluate({
    now,
    offer: {
      endTime: "not-a-date",
      expires: now,
      usageRule: "Unlimited",
    },
  });
  assert.equal(legacyFallbackAtBoundary.reason, "available");
  assert.equal(legacyFallbackAtBoundary.eligibilityExpiresAtMs, now.getTime() + 1);
  assertUnavailable(
    evaluate({
      now: new Date(now.getTime() + 1),
      offer: {
        endTime: "not-a-date",
        expires: now,
        usageRule: "Unlimited",
      },
    }),
    "expired",
  );
});

test("invalid now fails closed while malformed optional coupon dates stay compatible", () => {
  assertUnavailable(evaluate({now: new Date(NaN)}), "invalidSchedule");
  assert.equal(
    evaluate({
      offer: {
        startTime: "not-a-date",
        endTime: {toDate: () => {
          throw new Error("bad timestamp");
        }},
        usageRule: "Unlimited",
      },
    }).reason,
    "available",
  );
});

test("legacy date strings use Dart grammar and the request IANA time zone", () => {
  for (const endTime of [
    "12/31/2025",
    "09/10",
    "Thu, 01 Jan 2026 00:00:00 GMT",
  ]) {
    assert.equal(
      evaluate({offer: {endTime, usageRule: "Unlimited"}}).reason,
      "available",
      endTime,
    );
  }

  assertUnavailable(
    evaluate({
      offer: {startTime: "20260116", usageRule: "Unlimited"},
    }),
    "notStarted",
  );
  assertUnavailable(
    evaluate({
      offer: {startTime: "2026-01-42T12:00", usageRule: "Unlimited"},
    }),
    "notStarted",
  );

  for (const endTime of [
    "2026-01-15T12:00:00",
    " 2026-01-15T12:00:00-05:00 ",
  ]) {
    assert.equal(
      evaluate({
        now: new Date("2026-01-15T17:00:00.000Z"),
        offer: {endTime, usageRule: "Unlimited"},
      }).reason,
      "available",
      endTime,
    );
    assertUnavailable(
      evaluate({
        now: new Date("2026-01-15T17:00:00.001Z"),
        offer: {endTime, usageRule: "Unlimited"},
      }),
      "expired",
    );
  }
});

test("legacy local date strings resolve DST gaps and overlaps deterministically", () => {
  assert.equal(
    evaluate({
      now: new Date("2026-03-08T07:30:00.000Z"),
      offer: {endTime: "2026-03-08T02:30:00", usageRule: "Unlimited"},
    }).reason,
    "available",
  );
  assertUnavailable(
    evaluate({
      now: new Date("2026-03-08T07:30:00.001Z"),
      offer: {endTime: "2026-03-08T02:30:00", usageRule: "Unlimited"},
    }),
    "expired",
  );
  assert.equal(
    evaluate({
      now: new Date("2026-11-01T05:30:00.000Z"),
      offer: {endTime: "2026-11-01T01:30:00", usageRule: "Unlimited"},
    }).reason,
    "available",
  );
  assertUnavailable(
    evaluate({
      now: new Date("2026-11-01T05:30:00.001Z"),
      offer: {endTime: "2026-11-01T01:30:00", usageRule: "Unlimited"},
    }),
    "expired",
  );
});

test("legacy and Timestamp microseconds round safely at ms boundaries", () => {
  const boundary = "2026-01-15T12:00:00.123999-05:00";
  assertUnavailable(
    evaluate({
      now: new Date("2026-01-15T17:00:00.123Z"),
      offer: {startTime: boundary, usageRule: "Unlimited"},
    }),
    "notStarted",
  );
  assert.equal(
    evaluate({
      now: new Date("2026-01-15T17:00:00.124Z"),
      offer: {startTime: boundary, usageRule: "Unlimited"},
    }).reason,
    "available",
  );
  assert.equal(
    evaluate({
      now: new Date("2026-01-15T17:00:00.123Z"),
      offer: {endTime: boundary, usageRule: "Unlimited"},
    }).reason,
    "available",
  );
  assertUnavailable(
    evaluate({
      now: new Date("2026-01-15T17:00:00.124Z"),
      offer: {endTime: boundary, usageRule: "Unlimited"},
    }),
    "expired",
  );
  assert.equal(
    evaluate({
      offerType: "dailySpecial",
      now: new Date("2026-01-15T17:00:00.123Z"),
      offer: {availabilityMode: "todayOnly", expiresAt: boundary},
    }).reason,
    "available",
  );
  assertUnavailable(
    evaluate({
      offerType: "dailySpecial",
      now: new Date("2026-01-15T17:00:00.124Z"),
      offer: {availabilityMode: "todayOnly", expiresAt: boundary},
    }),
    "expired",
  );

  const timestampBoundary = {
    seconds: Date.parse("2026-01-15T17:00:00.000Z") / 1_000,
    nanoseconds: 123_999_000,
    toDate: () => new Date("2026-01-15T17:00:00.123Z"),
  };
  assertUnavailable(
    evaluate({
      now: new Date("2026-01-15T17:00:00.123Z"),
      offer: {startTime: timestampBoundary, usageRule: "Unlimited"},
    }),
    "notStarted",
  );
  assert.equal(
    evaluate({
      now: new Date("2026-01-15T17:00:00.123Z"),
      offer: {endTime: timestampBoundary, usageRule: "Unlimited"},
    }).reason,
    "available",
  );
  assertUnavailable(
    evaluate({
      offerType: "dailySpecial",
      now: new Date("2026-01-15T17:00:00.124Z"),
      offer: {availabilityMode: "todayOnly", expiresAt: timestampBoundary},
    }),
    "expired",
  );
});

test("daily-special today-only dates use the restaurant time zone", () => {
  const now = new Date("2026-03-08T06:30:00.000Z");
  const available = evaluate({
    offerType: "dailySpecial",
    now,
    offer: {
      availabilityMode: "todayOnly",
      createdAt: new Date("2026-03-08T05:30:00.000Z"),
    },
  });
  assert.equal(available.reason, "available");
  assertUnavailable(
    evaluate({
      offerType: "dailySpecial",
      now,
      offer: {
        availabilityMode: "todayOnly",
        createdAt: new Date("2026-03-08T04:30:00.000Z"),
      },
    }),
    "expired",
  );
  assertUnavailable(
    evaluate({
      offerType: "dailySpecial",
      now,
      offer: {availabilityMode: "todayOnly", expiresAt: now},
    }),
    "expired",
  );
});

test("specific-day schedules preserve numeric and legacy weekday strings", () => {
  const now = new Date("2026-03-09T16:00:00.000Z");
  assert.equal(
    customerBiteSaverAvailabilityLocalPartsForTesting(now, newYork).weekday,
    1,
  );
  for (const daysOfWeek of [
    [1],
    [" 1 "],
    ["+1"],
    ["01"],
    [1.9],
    [7, "1", 1],
    ["Monday"],
    [" MON "],
  ]) {
    assert.equal(
      evaluate({
        offerType: "dailySpecial",
        now,
        offer: {availabilityMode: "specificDays", daysOfWeek},
      }).reason,
      "available",
    );
  }
  for (const daysOfWeek of [[2], [], "1", [0, 8, "Funday"]]) {
    assertUnavailable(
      evaluate({
        offerType: "dailySpecial",
        now,
        offer: {availabilityMode: "specificDays", daysOfWeek},
      }),
      "wrongDay",
    );
  }

  const legacyNames = [
    ["monday", "mon"],
    ["tuesday", "tue"],
    ["wednesday", "wed"],
    ["thursday", "thu"],
    ["friday", "fri"],
    ["saturday", "sat"],
    ["sunday", "sun"],
  ];
  legacyNames.forEach((names, index) => {
    const localMidday = new Date(now.getTime() + index * 86_400_000);
    for (const name of names) {
      assert.equal(
        evaluate({
          offerType: "dailySpecial",
          now: localMidday,
          offer: {
            availabilityMode: "specificDays",
            daysOfWeek: [`  ${name.toUpperCase()}  `],
          },
        }).reason,
        "available",
      );
    }
  });

  assert.equal(
    evaluate({
      offerType: "dailySpecial",
      now,
      offer: {
        availabilityMode: " specificDays ",
        daysOfWeek: [1],
        expiresAt: new Date(now.getTime() - 1),
      },
    }).reason,
    "available",
  );
});

test("daily-special time windows are inclusive and honor hideWhenUnavailable", () => {
  const offer = {
    availabilityMode: "specificDays",
    daysOfWeek: [4],
    allDay: false,
    startTime: "12:00",
    endTime: "13:00",
  };
  for (const now of [
    new Date("2026-01-15T17:00:00.000Z"),
    new Date("2026-01-15T18:00:00.000Z"),
  ]) {
    const decision = evaluate({offerType: "dailySpecial", now, offer});
    assert.equal(decision.visible, true);
    assert.equal(decision.redeemable, true);
    assert.equal(decision.reason, "available");
  }

  assertUnavailable(
    evaluate({
      offerType: "dailySpecial",
      now: new Date("2026-01-15T16:59:00.000Z"),
      offer,
    }),
    "outsideTimeWindow",
  );
  const shownUnavailable = evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-01-15T18:01:00.000Z"),
    offer: {...offer, hideWhenUnavailable: false},
  });
  assert.equal(shownUnavailable.visible, true);
  assert.equal(shownUnavailable.redeemable, false);
  assert.equal(shownUnavailable.reason, "outsideTimeWindow");
});

test("daily-special positive windows retain their exact inclusive cutoff", () => {
  // 2026-09-09 08:03:00 America/New_York (EDT).
  const cutoff = 1_788_955_380_000;
  const offer = {
    availabilityMode: "specificDays",
    daysOfWeek: [3],
    allDay: false,
    startTime: "08:00",
    endTime: "08:02",
  };
  for (const nowMs of [
    1_788_955_200_000, // 08:00:00.000
    1_788_955_260_000, // 08:01:00.000
    1_788_955_320_000, // 08:02:00.000
    1_788_955_379_999, // 08:02:59.999
  ]) {
    assertAvailableUntil(evaluate({
      offerType: "dailySpecial",
      now: new Date(nowMs),
      offer,
    }), cutoff);
  }
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(cutoff),
    offer,
  }), "outsideTimeWindow");
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(cutoff + 1),
    offer,
  }), "outsideTimeWindow");

  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(1_788_955_200_000),
    offer: {...offer, hideWhenUnavailable: false},
  }), cutoff);
  assert.deepEqual(evaluate({
    offerType: "dailySpecial",
    now: new Date(cutoff),
    offer: {...offer, hideWhenUnavailable: false},
  }), {
    visible: true,
    redeemable: false,
    reason: "outsideTimeWindow",
    usageState: "available",
    activeTimerExpiresAtMs: null,
    nextAvailableAtMs: null,
    proximityDistanceMiles: null,
    eligibilityExpiresAtMs: 1_789_012_800_000,
  });
});

test("daily-special day scopes retain the next local-midnight cutoff", () => {
  // 2026-09-10 00:00:00 America/New_York (EDT).
  const cutoff = 1_789_012_800_000;
  const initial = 1_788_955_200_000; // Wed 2026-09-09 08:00 EDT.
  const lastValid = cutoff - 1;
  const cases = [
    {
      label: "specific day",
      offer: {availabilityMode: "specificDays", daysOfWeek: [3]},
      cutoffReason: "wrongDay",
    },
    {
      label: "expiry-less today-only",
      offer: {
        availabilityMode: "todayOnly",
        createdAt: new Date(1_788_951_600_000),
      },
      cutoffReason: "expired",
    },
  ];
  for (const fixture of cases) {
    for (const nowMs of [initial, lastValid]) {
      assertAvailableUntil(evaluate({
        offerType: "dailySpecial",
        now: new Date(nowMs),
        offer: fixture.offer,
      }), cutoff);
    }
    assertUnavailable(evaluate({
      offerType: "dailySpecial",
      now: new Date(cutoff),
      offer: fixture.offer,
    }), fixture.cutoffReason);
    assertUnavailable(evaluate({
      offerType: "dailySpecial",
      now: new Date(cutoff + 1),
      offer: fixture.offer,
    }), fixture.cutoffReason);
  }

  const consecutive = {
    availabilityMode: "specificDays",
    daysOfWeek: [3, 4],
  };
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(initial),
    offer: consecutive,
  }), cutoff);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(cutoff),
    offer: consecutive,
  }), 1_789_099_200_000); // Fri 2026-09-11 00:00 EDT.
});

test("daily-special restrictions choose the earliest positive boundary", () => {
  const now = new Date(1_788_955_200_000); // 2026-09-09 08:00 EDT.
  const timed = {
    availabilityMode: "todayOnly",
    allDay: false,
    startTime: "08:00",
    endTime: "08:02",
  };
  const earlyExpiry = 1_788_955_260_000; // 08:01 EDT.
  const windowCutoff = 1_788_955_380_000; // 08:03 EDT.
  const lateExpiry = 1_788_955_800_000; // 08:10 EDT.
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now,
    offer: {...timed, expiresAt: new Date(earlyExpiry)},
  }), earlyExpiry);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(earlyExpiry),
    offer: {...timed, expiresAt: new Date(earlyExpiry)},
  }), "expired");
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now,
    offer: {...timed, expiresAt: new Date(lateExpiry)},
  }), windowCutoff);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now,
    offer: {
      ...timed,
      availabilityMode: "specificDays",
      daysOfWeek: [3],
    },
  }), windowCutoff);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now,
    offer: {availabilityMode: "todayOnly", expiresAt: new Date(lateExpiry)},
  }), lateExpiry);

  assert.equal(evaluate({
    now,
    offer: {usageRule: "Unlimited"},
  }).eligibilityExpiresAtMs, null);
});

test("daily-special local-day deadlines honor UTC and daylight-saving days", () => {
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "UTC",
    now: new Date(1_768_464_000_000), // 2026-01-15 08:00 UTC.
    offer: {
      availabilityMode: "specificDays",
      daysOfWeek: [4],
      allDay: false,
      startTime: "08:00",
      endTime: "08:02",
    },
  }), 1_768_464_180_000); // 2026-01-15 08:03 UTC.

  const dayCases = [
    {
      label: "spring-forward specific day",
      nowMs: 1_772_947_800_000, // Sun 2026-03-08 00:30 EST.
      cutoffMs: 1_773_028_800_000, // Mon 00:00 EDT, a 23-hour day.
      offer: {availabilityMode: "specificDays", daysOfWeek: [7]},
      cutoffReason: "wrongDay",
    },
    {
      label: "spring-forward expiry-less today-only",
      nowMs: 1_772_947_800_000,
      cutoffMs: 1_773_028_800_000,
      offer: {
        availabilityMode: "todayOnly",
        createdAt: new Date(1_772_946_300_000),
      },
      cutoffReason: "expired",
    },
    {
      label: "fall-back specific day",
      nowMs: 1_793_507_400_000, // Sun 2026-11-01 00:30 EDT.
      cutoffMs: 1_793_595_600_000, // Mon 00:00 EST, a 25-hour day.
      offer: {availabilityMode: "specificDays", daysOfWeek: [7]},
      cutoffReason: "wrongDay",
    },
    {
      label: "fall-back expiry-less today-only",
      nowMs: 1_793_507_400_000,
      cutoffMs: 1_793_595_600_000,
      offer: {
        availabilityMode: "todayOnly",
        createdAt: new Date(1_793_505_900_000),
      },
      cutoffReason: "expired",
    },
  ];
  for (const fixture of dayCases) {
    assertAvailableUntil(evaluate({
      offerType: "dailySpecial",
      now: new Date(fixture.nowMs),
      offer: fixture.offer,
    }), fixture.cutoffMs);
    assertAvailableUntil(evaluate({
      offerType: "dailySpecial",
      now: new Date(fixture.cutoffMs - 1),
      offer: fixture.offer,
    }), fixture.cutoffMs);
    assertUnavailable(evaluate({
      offerType: "dailySpecial",
      now: new Date(fixture.cutoffMs),
      offer: fixture.offer,
    }), fixture.cutoffReason);
  }

  for (const fixture of [
    {
      nowMs: 1_772_971_200_000, // Sun 2026-03-08 08:00 EDT.
      cutoffMs: 1_773_028_800_000,
    },
    {
      nowMs: 1_793_538_000_000, // Sun 2026-11-01 08:00 EST.
      cutoffMs: 1_793_595_600_000,
    },
  ]) {
    assertAvailableUntil(evaluate({
      offerType: "dailySpecial",
      now: new Date(fixture.nowMs),
      offer: {
        availabilityMode: "specificDays",
        daysOfWeek: [7],
        allDay: false,
        startTime: "08:00",
        endTime: "23:59",
      },
    }), fixture.cutoffMs);
  }
});

test("daily-special window deadlines stop safely at DST gaps and folds", () => {
  const springGapOffer = {
    availabilityMode: "specificDays",
    daysOfWeek: [7],
    allDay: false,
    startTime: "01:00",
    endTime: "02:30",
  };
  const springGapCutoff = 1_772_953_200_000; // 03:00 EDT after 01:59 EST.
  for (const nowMs of [
    1_772_949_600_000, // 01:00 EST.
    springGapCutoff - 1,
  ]) {
    assertAvailableUntil(evaluate({
      offerType: "dailySpecial",
      now: new Date(nowMs),
      offer: springGapOffer,
    }), springGapCutoff);
  }
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(springGapCutoff),
    offer: springGapOffer,
  }), "outsideTimeWindow");

  const acrossGap = {...springGapOffer, endTime: "03:30"};
  const acrossGapCutoff = 1_772_955_060_000; // 03:31 EDT.
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(1_772_949_600_000),
    offer: acrossGap,
  }), acrossGapCutoff);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(acrossGapCutoff),
    offer: acrossGap,
  }), "outsideTimeWindow");

  const repeatedHourOffer = {
    availabilityMode: "specificDays",
    daysOfWeek: [7],
    allDay: false,
    startTime: "00:00",
    endTime: "01:30",
  };
  const firstCutoff = 1_793_511_060_000; // First 01:31, EDT.
  const secondStart = 1_793_512_800_000; // Second 01:00, EST.
  const secondCutoff = 1_793_514_660_000; // Second 01:31, EST.
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(1_793_509_200_000), // First 01:00, EDT.
    offer: repeatedHourOffer,
  }), firstCutoff);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(firstCutoff - 1),
    offer: repeatedHourOffer,
  }), firstCutoff);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(firstCutoff),
    offer: repeatedHourOffer,
  }), "outsideTimeWindow");
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(secondStart),
    offer: repeatedHourOffer,
  }), secondCutoff);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(secondCutoff - 1),
    offer: repeatedHourOffer,
  }), secondCutoff);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(secondCutoff),
    offer: repeatedHourOffer,
  }), "outsideTimeWindow");
});

test("daily-special fall-back deadlines stop at a temporary loss and allow fresh reentry", () => {
  const offer = {
    availabilityMode: "specificDays",
    daysOfWeek: [7],
    allDay: false,
    startTime: "01:30",
    endTime: "02:30",
    hideWhenUnavailable: true,
  };
  const rollbackAtMs = Date.parse("2026-11-01T06:00:00.000Z");
  const laterEndBoundaryMs = Date.parse("2026-11-01T07:31:00.000Z");
  const firstDecision = evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-11-01T05:45:00.000Z"), // First 01:45, EDT.
    offer,
  });
  assertAvailableUntil(firstDecision, rollbackAtMs);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date(rollbackAtMs - 1),
    offer,
  }), rollbackAtMs);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(rollbackAtMs), // 01:00, EST.
    offer,
  }), "outsideTimeWindow");
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(rollbackAtMs + 1),
    offer,
  }), "outsideTimeWindow");

  const reentered = evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-11-01T06:30:00.000Z"), // Second 01:30, EST.
    offer,
  });
  assertAvailableUntil(reentered, laterEndBoundaryMs);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-11-01T06:45:00.000Z"), // Second 01:45, EST.
    offer,
  }), laterEndBoundaryMs);
  assert.equal(firstDecision.eligibilityExpiresAtMs, rollbackAtMs);
  assert.notEqual(
    firstDecision.eligibilityExpiresAtMs,
    reentered.eligibilityExpiresAtMs,
  );

  const shownUnavailable = evaluate({
    offerType: "dailySpecial",
    now: new Date(rollbackAtMs),
    offer: {...offer, hideWhenUnavailable: false},
  });
  assert.equal(shownUnavailable.visible, true);
  assert.equal(shownUnavailable.redeemable, false);
  assert.equal(shownUnavailable.reason, "outsideTimeWindow");
  assert.equal(
    shownUnavailable.eligibilityExpiresAtMs,
    Date.parse("2026-11-02T05:00:00.000Z"),
  );
});

test("daily-special fold deadlines preserve safe, earlier, and non-hour boundaries", () => {
  const common = {
    availabilityMode: "specificDays",
    daysOfWeek: [7],
    allDay: false,
    hideWhenUnavailable: true,
  };
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-11-01T05:45:00.000Z"), // First 01:45, EDT.
    offer: {...common, startTime: "01:00", endTime: "02:30"},
  }), Date.parse("2026-11-01T07:31:00.000Z"));
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-11-01T06:00:00.000Z"), // Second 01:00, EST.
    offer: {...common, startTime: "01:00", endTime: "02:30"},
  }), Date.parse("2026-11-01T07:31:00.000Z"));

  const earlierEndBoundaryMs = Date.parse("2026-11-01T05:51:00.000Z");
  const earlierEndOffer = {
    ...common,
    startTime: "01:30",
    endTime: "01:50",
  };
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-11-01T05:45:00.000Z"),
    offer: earlierEndOffer,
  }), earlierEndBoundaryMs);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    now: new Date(earlierEndBoundaryMs),
    offer: earlierEndOffer,
  }), "outsideTimeWindow");

  const lordHoweOffer = {
    ...common,
    startTime: "01:45",
    endTime: "02:30",
  };
  const lordHoweRollbackAtMs = Date.parse("2026-04-04T15:00:00.000Z");
  const lordHoweLaterEndBoundaryMs = Date.parse("2026-04-04T16:01:00.000Z");
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "Australia/Lord_Howe",
    now: new Date("2026-04-04T14:50:00.000Z"), // First 01:50, UTC+11.
    offer: lordHoweOffer,
  }), lordHoweRollbackAtMs);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "Australia/Lord_Howe",
    now: new Date(lordHoweRollbackAtMs - 1),
    offer: lordHoweOffer,
  }), lordHoweRollbackAtMs);
  assertUnavailable(evaluate({
    offerType: "dailySpecial",
    timeZone: "Australia/Lord_Howe",
    now: new Date(lordHoweRollbackAtMs), // 01:30, UTC+10:30.
    offer: lordHoweOffer,
  }), "outsideTimeWindow");
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "Australia/Lord_Howe",
    now: new Date("2026-04-04T15:15:00.000Z"), // Second 01:45, UTC+10:30.
    offer: lordHoweOffer,
  }), lordHoweLaterEndBoundaryMs);
});

test("daily-special deadlines revalidate across an IANA local-date skip", () => {
  const dateSkipAtMs = Date.parse("2011-12-30T10:00:00.000Z");
  const offer = {
    availabilityMode: "specificDays",
    // Thursday before the skip and Saturday after it are both configured. The
    // old decision still ends when Pacific/Apia skips Friday in its entirety.
    daysOfWeek: [4, 6],
    allDay: false,
    startTime: "00:00",
    endTime: "23:59",
  };
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "Pacific/Apia",
    now: new Date("2011-12-30T09:30:00.000Z"), // Thu Dec 29, 23:30 UTC-10.
    offer,
  }), dateSkipAtMs);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "Pacific/Apia",
    now: new Date(dateSkipAtMs - 1),
    offer,
  }), dateSkipAtMs);
  assertAvailableUntil(evaluate({
    offerType: "dailySpecial",
    timeZone: "Pacific/Apia",
    now: new Date(dateSkipAtMs), // Sat Dec 31, 00:00 UTC+14.
    offer,
  }), Date.parse("2011-12-31T10:00:00.000Z"));
});

test("daily-special legacy booleans match the Dart reader", () => {
  const timedOffer = {
    availabilityMode: " specificDays ",
    daysOfWeek: [4],
    allDay: " FALSE ",
    startTime: "12:00",
    endTime: "13:00",
  };
  assert.equal(
    evaluate({offerType: "dailySpecial", offer: timedOffer}).reason,
    "available",
  );
  const outside = evaluate({
    offerType: "dailySpecial",
    now: new Date("2026-01-15T18:01:00.000Z"),
    offer: {...timedOffer, hideWhenUnavailable: 0},
  });
  assert.equal(outside.visible, true);
  assert.equal(outside.redeemable, false);
  assert.equal(outside.reason, "outsideTimeWindow");
  for (const allDay of [1, -1, Number.NaN, " TRUE ", "malformed"]) {
    assert.equal(
      evaluate({
        offerType: "dailySpecial",
        offer: {
          availabilityMode: "specificDays",
          daysOfWeek: [4],
          allDay,
          startTime: "malformed",
          endTime: "malformed",
        },
      }).reason,
      "available",
    );
  }
  assert.equal(
    evaluate({
      offerType: "dailySpecial",
      locationMode: "typed",
      offer: {isProximityOnly: "true"},
    }).reason,
    "available",
  );
});

test("malformed and overnight daily-special windows fail closed", () => {
  for (const [startTime, endTime] of [
    [undefined, "13:00"],
    ["12:00", undefined],
    ["25:00", "26:00"],
    ["13:00", "12:00"],
    ["12:00", "12:00"],
  ]) {
    assertUnavailable(
      evaluate({
        offerType: "dailySpecial",
        offer: {
          availabilityMode: "specificDays",
          daysOfWeek: [4],
          allDay: false,
          startTime,
          endTime,
        },
      }),
      "invalidSchedule",
    );
    const shownUnavailable = evaluate({
      offerType: "dailySpecial",
      offer: {
        availabilityMode: "specificDays",
        daysOfWeek: [4],
        allDay: false,
        startTime,
        endTime,
        hideWhenUnavailable: false,
      },
    });
    assert.equal(shownUnavailable.visible, true);
    assert.equal(shownUnavailable.redeemable, false);
    assert.equal(shownUnavailable.reason, "invalidSchedule");
  }
});

test("time-zone conversion covers DST gaps, repeated hours, and midnight", () => {
  assert.deepEqual(
    customerBiteSaverAvailabilityLocalPartsForTesting(
      new Date("2026-03-08T06:59:00.000Z"),
      newYork,
    ),
    {year: 2026, month: 3, day: 8, weekday: 7, hour: 1, minute: 59},
  );
  assert.deepEqual(
    customerBiteSaverAvailabilityLocalPartsForTesting(
      new Date("2026-03-08T07:00:00.000Z"),
      newYork,
    ),
    {year: 2026, month: 3, day: 8, weekday: 7, hour: 3, minute: 0},
  );
  for (const instant of [
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]) {
    assert.deepEqual(
      customerBiteSaverAvailabilityLocalPartsForTesting(
        new Date(instant),
        newYork,
      ),
      {year: 2026, month: 11, day: 1, weekday: 7, hour: 1, minute: 30},
    );
  }
  assert.deepEqual(
    customerBiteSaverAvailabilityLocalPartsForTesting(
      new Date("2026-03-09T04:00:00.000Z"),
      newYork,
    ),
    {year: 2026, month: 3, day: 9, weekday: 1, hour: 0, minute: 0},
  );
});

test("once-per-customer and unknown usage states are unavailable", () => {
  const redeemedAt = new Date("2026-01-14T17:00:00.000Z");
  const once = evaluate({
    offer: {usageRule: "Once per customer"},
    usage: usage({lastRedeemedAt: redeemedAt}),
  });
  assert.equal(once.visible, false);
  assert.equal(once.redeemable, false);
  assert.equal(once.reason, "used");
  assert.equal(once.usageState, "unavailable");

  const unknown = evaluate({
    offer: {usageRule: "Once per customer"},
    usage: usage({known: false}),
  });
  assert.equal(unknown.visible, true);
  assert.equal(unknown.redeemable, false);
  assert.equal(unknown.reason, "usageUnknown");
  assert.equal(unknown.usageState, "unknown");

  for (const usageRule of ["", "   "]) {
    const blankDefaultsToOncePerCustomer = evaluate({
      offer: {usageRule},
      usage: usage({lastRedeemedAt: redeemedAt}),
    });
    assert.equal(blankDefaultsToOncePerCustomer.visible, false);
    assert.equal(blankDefaultsToOncePerCustomer.redeemable, false);
    assert.equal(blankDefaultsToOncePerCustomer.reason, "used");
    assert.equal(blankDefaultsToOncePerCustomer.usageState, "unavailable");
  }
});

test("once-per-day resets at local 12:01 AM, including after DST", () => {
  const lastRedeemedAt = new Date("2026-03-08T16:00:00.000Z");
  const atMidnight = evaluate({
    now: new Date("2026-03-09T04:00:00.000Z"),
    offer: {usageRule: "Once per day"},
    usage: usage({lastRedeemedAt}),
  });
  assert.equal(atMidnight.reason, "used");
  assert.equal(atMidnight.usageState, "unavailable");
  assert.equal(
    atMidnight.nextAvailableAtMs,
    Date.parse("2026-03-09T04:01:00.000Z"),
  );

  const atReset = evaluate({
    now: new Date("2026-03-09T04:01:00.000Z"),
    offer: {usageRule: "Once per day"},
    usage: usage({lastRedeemedAt}),
  });
  assert.equal(atReset.reason, "available");
  assert.equal(atReset.usageState, "available");
  assert.equal(atReset.nextAvailableAtMs, null);

  const sameDay = evaluate({
    now: new Date("2026-03-08T20:00:00.000Z"),
    offer: {usageRule: "Once per day"},
    usage: usage({lastRedeemedAt}),
  });
  assert.equal(sameDay.reason, "used");
  assert.equal(
    sameDay.nextAvailableAtMs,
    Date.parse("2026-03-09T04:01:00.000Z"),
  );

  const beforeFallReset = evaluate({
    now: new Date("2026-11-02T05:00:00.000Z"),
    offer: {usageRule: "Once per day"},
    usage: usage({
      lastRedeemedAt: new Date("2026-11-01T17:00:00.000Z"),
    }),
  });
  assert.equal(beforeFallReset.reason, "used");
  assert.equal(
    beforeFallReset.nextAvailableAtMs,
    Date.parse("2026-11-02T05:01:00.000Z"),
  );
});

test("once-per-day calendar comparisons remain exact across month and year boundaries", () => {
  for (const {now, lastRedeemedAt, expectedReason} of [
    {
      now: "2026-09-01T04:00:00.000Z",
      lastRedeemedAt: "2026-08-31T16:00:00.000Z",
      expectedReason: "used",
    },
    {
      now: "2026-09-02T04:00:00.000Z",
      lastRedeemedAt: "2026-08-31T16:00:00.000Z",
      expectedReason: "available",
    },
    {
      now: "2027-01-01T05:00:00.000Z",
      lastRedeemedAt: "2026-12-31T17:00:00.000Z",
      expectedReason: "used",
    },
    {
      now: "2027-01-02T05:00:00.000Z",
      lastRedeemedAt: "2026-12-31T17:00:00.000Z",
      expectedReason: "available",
    },
  ]) {
    const decision = evaluate({
      now: new Date(now),
      offer: {usageRule: "Once per day"},
      usage: usage({lastRedeemedAt: new Date(lastRedeemedAt)}),
    });
    assert.equal(decision.reason, expectedReason);
    assert.equal(
      decision.usageState,
      expectedReason === "available" ? "available" : "unavailable",
    );
  }
});

test("unlimited and unknown legacy usage strings retain reusable compatibility", () => {
  const unlimited = evaluate({
    offer: {usageRule: "Unlimited"},
    usage: usage({known: false, lastRedeemedAt: input().now}),
  });
  assert.equal(unlimited.reason, "available");
  assert.equal(unlimited.usageState, "available");
  assert.equal(unlimited.redeemable, true);

  const legacy = evaluate({
    offer: {usageRule: "legacy mystery value"},
    usage: usage({known: false, lastRedeemedAt: input().now}),
  });
  assert.equal(legacy.reason, "available");
  assert.equal(legacy.usageState, "available");
  assert.equal(legacy.redeemable, true);

  const timerStartedAt = new Date("2026-01-15T16:59:00.000Z");
  const legacyWithTimer = evaluate({
    offer: {usageRule: "legacy mystery value"},
    usage: usage({timerStartedAt}),
  });
  assert.equal(
    legacyWithTimer.activeTimerExpiresAtMs,
    timerStartedAt.getTime() + customerBiteSaverRedemptionTimerMilliseconds,
  );
});

test("active redemption timer is returned only before the exact five-minute boundary", () => {
  assert.equal(customerBiteSaverRedemptionTimerMilliseconds, 300_000);
  const timerStartedAt = new Date("2026-01-15T16:55:01.000Z");
  const active = evaluate({
    offer: {usageRule: "Once per customer"},
    usage: usage({timerStartedAt}),
  });
  assert.equal(
    active.activeTimerExpiresAtMs,
    timerStartedAt.getTime() + customerBiteSaverRedemptionTimerMilliseconds,
  );
  assert.equal(active.reason, "available");
  assert.equal(active.eligibilityExpiresAtMs, active.activeTimerExpiresAtMs);
  const expired = evaluate({
    offer: {usageRule: "Once per customer"},
    usage: usage({
      timerStartedAt: new Date("2026-01-15T16:55:00.000Z"),
    }),
  });
  assert.equal(expired.activeTimerExpiresAtMs, null);
  assert.equal(expired.visible, false);
  assert.equal(expired.redeemable, false);
  assert.equal(expired.reason, "used");

  const laterRedemption = new Date("2026-01-15T16:59:30.000Z");
  const latestUsageWins = evaluate({
    offer: {usageRule: "Once per customer"},
    usage: usage({
      lastRedeemedAt: laterRedemption,
      timerStartedAt: new Date("2026-01-15T16:50:00.000Z"),
    }),
  });
  assert.equal(latestUsageWins.reason, "used");

  const elapsedDailyTimer = evaluate({
    now: new Date("2026-01-15T17:00:00.000Z"),
    offer: {usageRule: "Once per day"},
    usage: usage({timerStartedAt: new Date("2026-01-15T16:55:00.000Z")}),
  });
  assert.equal(elapsedDailyTimer.reason, "used");
  assert.equal(
    elapsedDailyTimer.nextAvailableAtMs,
    Date.parse("2026-01-16T05:01:00.000Z"),
  );
});

test("proximity-only offers require current mode and a fresh valid location", () => {
  const offer = {
    usageRule: "Unlimited",
    isProximityOnly: " TRUE ",
    proximityRadiusMiles: " 1e0 ",
  };
  assertUnavailable(evaluate({offer, locationMode: "typed"}), "typedLocation");
  assertUnavailable(
    evaluate({offer, currentCoordinates: null}),
    "missingFreshLocation",
  );
  assertUnavailable(
    evaluate({offer, restaurantCoordinates: null}),
    "missingFreshLocation",
  );
  assertUnavailable(
    evaluate({
      offer,
      currentCoordinates: {latitude: 0, longitude: 0},
    }),
    "missingFreshLocation",
  );
});

test("fresh-location age and future-skew boundaries are inclusive", () => {
  assert.equal(customerBiteSaverFreshLocationMaximumAgeMilliseconds, 120_000);
  const now = input().now;
  const offer = {
    usageRule: "Unlimited",
    isProximityOnly: true,
    proximityRadiusMiles: 1,
  };
  for (const capturedAtMs of [
    now.getTime() - customerBiteSaverFreshLocationMaximumAgeMilliseconds,
    now.getTime() + 5_000,
  ]) {
    const decision = evaluate({
      now,
      offer,
      requireFreshLocation: true,
      currentCoordinatesCapturedAt: new Date(capturedAtMs),
    });
    assert.equal(decision.reason, "available");
    assert.equal(
      decision.eligibilityExpiresAtMs,
      capturedAtMs + customerBiteSaverFreshLocationMaximumAgeMilliseconds + 1,
    );
  }
  for (const capturedAtMs of [
    now.getTime() - customerBiteSaverFreshLocationMaximumAgeMilliseconds - 1,
    now.getTime() + 5_001,
  ]) {
    assertUnavailable(
      evaluate({
        now,
        offer,
        requireFreshLocation: true,
        currentCoordinatesCapturedAt: new Date(capturedAtMs),
      }),
      "missingFreshLocation",
    );
  }
  assertUnavailable(
    evaluate({offer, requireFreshLocation: true, currentCoordinatesCapturedAt: null}),
    "missingFreshLocation",
  );
});

test("proximity distance is exact, radius-inclusive, and invalid radii fail closed", () => {
  const samePoint = evaluate({
    offer: {
      usageRule: "Unlimited",
      isProximityOnly: true,
      proximityRadiusMiles: 0,
    },
  });
  assert.equal(samePoint.reason, "available");
  assert.equal(samePoint.proximityDistanceMiles, 0);

  const boundaryCoordinates = {
    latitude: restaurantCoordinates.latitude +
      (1_609.344 / 6_378_137) * (180 / Math.PI),
    longitude: restaurantCoordinates.longitude,
  };
  const exactBoundaryMiles = exactCustomerBiteSaverDistanceMiles(
    restaurantCoordinates,
    boundaryCoordinates,
  );
  const boundary = evaluate({
    offer: {
      usageRule: "Unlimited",
      isProximityOnly: true,
      proximityRadiusMiles: exactBoundaryMiles,
    },
    currentCoordinates: boundaryCoordinates,
  });
  assert.equal(boundary.reason, "available");
  assert.equal(boundary.proximityDistanceMiles, exactBoundaryMiles);
  assertUnavailable(
    evaluate({
      offer: {
        usageRule: "Unlimited",
        isProximityOnly: true,
        proximityRadiusMiles: exactBoundaryMiles - 1e-12,
      },
      currentCoordinates: boundaryCoordinates,
    }),
    "outsideProximity",
  );

  assertUnavailable(
    evaluate({
      offer: {
        usageRule: "Unlimited",
        isProximityOnly: true,
        proximityRadiusMiles: 0.01,
      },
      currentCoordinates: {latitude: 28.6383, longitude: -81.3792},
    }),
    "outsideProximity",
  );
  for (const proximityRadiusMiles of [-1, NaN, Infinity, "Infinity", "bad"]) {
    assertUnavailable(
      evaluate({
        offer: {
          usageRule: "Unlimited",
          isProximityOnly: true,
          proximityRadiusMiles,
        },
      }),
      "outsideProximity",
    );
  }
  assert.equal(
    evaluate({
      offer: {
        usageRule: "Unlimited",
        isProximityOnly: " false ",
        proximityRadiusMiles: "bad",
      },
    }).reason,
    "available",
  );
});
