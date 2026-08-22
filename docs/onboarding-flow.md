# Rider onboarding flow — design sketch

Not built yet. This is the shape to agree on first.

## The one principle

**Code decides, the model only phrases.**

The model never decides which question comes next, never decides whether a field
is valid, and never decides whether onboarding is complete. Those are a checklist
and a set of rules — exact, testable, free. Ask an LLM "have I got everything?"
and one day it will say yes with two fields blank, confidently, in fluent Roman
Urdu.

The model does exactly two jobs:

1. **Read** a rider's messy reply and pull out a value (JSON Schema mode).
2. **Speak** — answer an FAQ question mid-flow, grounded in `knowledge.ts`.

Most turns need neither. The next question is canned Roman Urdu text, so the
common path costs no tokens and no latency at all.

## Screen before you collect

Ask the disqualifying questions **first**, before any document upload or payment.
Five facts decide whether someone can do this job at all. A rider who cannot
should learn that in two minutes, not after photographing their CNIC.

```mermaid
stateDiagram-v2
    [*] --> Welcome
    Welcome --> Screening
    Screening --> Ineligible: any gate fails
    Screening --> Details: all gates pass
    Details --> Documents
    Documents --> Deposit
    Deposit --> Appointment
    Appointment --> Complete
    Ineligible --> [*]
    Complete --> [*]
```

## Fields

### 1. Screening — gates, ask first

| Field | Rule | If it fails |
| --- | --- | --- |
| `age_18_plus` | must be true | stop, explain 18+ requirement |
| `owns_motorbike` | must be true | stop, own bike is required |
| `smartphone_ok` | iOS ≥ 9.0 or Android ≥ 7.0 | stop, smartphone is essential |
| `has_cnic` | must be true | stop |
| `has_license` | learner's or full | stop |

Stopping is not a rejection — record the reason and leave the door open.

### 2. Details

| Field | Validation |
| --- | --- |
| `full_name` | as printed on CNIC, non-empty, letters/spaces |
| `cnic_number` | 13 digits, checksum-free but format-checked |
| `phone` | Pakistani mobile format |
| `branch` | one of: F8 Markaz, Rawalpindi |

### 3. Documents — upload, OCR, then compare in code

| Document | Checked against |
| --- | --- |
| `profile_photo` | is a face, not a screenshot |
| `cnic` | OCR name + number **must match** what the rider typed |
| `license` | type is learner's or full; not expired |
| `utility_bill` | recent; address present |

The model is not shown these images — gpt-oss-120b has no vision, and it
shouldn't be judging documents anyway. The OCR API returns fields, **code**
compares them, and the model is only asked to phrase the outcome:
*"CNIC ka number aap ke likhay huay number se match nahi kar raha."*

### 4. Deposit and appointment

| Field | Notes |
| --- | --- |
| `deposit_paid` | Rs. 2,500 — **see open question** — via easypaisa / JazzCash / HBL Konnect |
| `deposit_proof` | screenshot, stored and checked by a human |
| `appointment` | branch visit, Mon–Fri, 12 PM–6 PM |

## What happens on each rider message

```
1. Is there a pending question?
2. Classify the message in ONE small model call (JSON Schema):
      { intent: "answer" | "question" | "other", value: string | null }
3. intent = answer   -> validate in CODE
                          pass -> save, advance, send the next canned question
                          fail -> re-ask with a specific hint (attempt 3 -> human)
   intent = question -> answer from knowledge.ts, then repeat the pending question
   intent = other    -> canned guard-rail line, then repeat the pending question
```

One small call per turn. Deterministic state. Every validation rule is unit
testable without touching the model.

## Storage — the part that needs real care

The bot is stateless today; the browser holds everything. This flow breaks that.

```
rider_session(id, phone, state, created_at, updated_at, ineligible_reason)
rider_field(session_id, key, value, verified_at)
rider_document(session_id, kind, object_key, ocr_json, status, checked_at)
```

You will be holding CNIC numbers, licences and utility bills — precisely the set
identity theft is built from, belonging to people with little recourse if it
leaks. That means, before the first real rider:

- encryption at rest, and private object storage with signed short-lived URLs
- access control and an audit trail on who reads a document
- a retention policy — what is deleted once onboarding completes, and when
- never log field values or OCR output
- the existing rule stays absolute: never ask for a PIN, password or OTP

## Open questions

1. **Security deposit: Rs. 1,500 or Rs. 2,500?** The FAQ says both. Rs. 2,500 is
   implemented. This is money riders hand over before earning anything.
2. Is a rider who fails a gate re-contactable later, or closed permanently?
3. Who reviews deposit proofs and document mismatches, and where do they see them?
4. Does the branch appointment need real slot booking, or is "Mon–Fri 12–6" enough?
