import re
from typing import Dict, Any, Tuple

def validate_positioning(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Validates positioning and ICP docs. Check for target audience, problem, solution, value proposition.
    """
    results = {
        "checks": {},
        "score": 0,
        "feedback": []
    }
    
    # Required keys in positioning artifact
    required_keys = ["target_audience", "core_problem", "value_proposition", "primary_benefit"]
    for key in required_keys:
        val = data.get(key, "")
        if val and isinstance(val, str) and len(val.strip()) > 10:
            results["checks"][f"has_{key}"] = True
            results["score"] += 25
        else:
            results["checks"][f"has_{key}"] = False
            results["feedback"].append(f"Attribute '{key}' is too short or missing. It should contain detailed description.")
            
    success = results["score"] >= 75
    return success, results

def validate_landing_page(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Validates landing page structure. Expecting a title, a CTA, features, and optionally a mock HTTP status check.
    """
    results = {
        "checks": {},
        "score": 0,
        "feedback": []
    }
    
    # Check landing page structure
    hero_headline = data.get("hero_headline", "")
    if len(hero_headline.strip()) >= 15:
        results["checks"]["hero_headline_valid"] = True
        results["score"] += 30
    else:
        results["checks"]["hero_headline_valid"] = False
        results["feedback"].append("Hero headline must be strong and at least 15 characters.")

    cta = data.get("cta_text", "")
    if len(cta.strip()) >= 3:
        results["checks"]["cta_valid"] = True
        results["score"] += 20
    else:
        results["checks"]["cta_valid"] = False
        results["feedback"].append("landing page needs a clear, active Call To Action (CTA).")

    # Mocking a deployed URL check
    url = data.get("url", "")
    if url:
        # Simple regex for URL formatting
        url_regex = re.compile(
            r'^(?:http)s?://' # http:// or https://
            r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+(?:[A-Z]{2,6}\.?|[A-Z0-9-]{2,}\.?)|' #domain...
            r'localhost|' #localhost...
            r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})' # ...or ip
            r'(?::\d+)?' # optional port
            r'(?:/?|[/?]\S+)$', re.IGNORECASE)
        
        if re.match(url_regex, url):
            results["checks"]["url_format_valid"] = True
            results["score"] += 30
            # Simulating deterministic HTTP status success for demo
            results["checks"]["http_status_200"] = True
            results["score"] += 20
        else:
            results["checks"]["url_format_valid"] = False
            results["checks"]["http_status_200"] = False
            results["feedback"].append("Deployed Landing page URL format is invalid.")
    else:
        results["checks"]["url_format_valid"] = False
        results["checks"]["http_status_200"] = False
        results["feedback"].append("No landing page deploy URL was specified.")

    success = results["score"] >= 70
    return success, results

def validate_marketing_email(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Validates email subject line and body copy. Check copy length and CTA parameters.
    """
    results = {
        "checks": {},
        "score": 0,
        "feedback": []
    }
    
    subject = data.get("subject", "")
    if len(subject.strip()) >= 10:
        results["checks"]["subject_length_valid"] = True
        results["score"] += 30
    else:
        results["checks"]["subject_length_valid"] = False
        results["feedback"].append("Subject line is too short. It should grab the customer's attention.")

    body = data.get("body", "")
    if len(body.strip()) >= 100:
        results["checks"]["body_length_valid"] = True
        results["score"] += 40
    else:
        results["checks"]["body_length_valid"] = False
        results["feedback"].append("Body copy is too brief. You need a narrative arc and detailed value pitch.")

    # CTA presence check within the email body
    if "[CTA]" in body or "[link]" in body or "http" in body or "Click here" in body or "Sign up" in body:
        results["checks"]["body_cta_included"] = True
        results["score"] += 30
    else:
        results["checks"]["body_cta_included"] = False
        results["feedback"].append("Email body copy is missing an explicit clickable action or link placeholder (e.g. '[CTA]').")

    success = results["score"] >= 70
    return success, results


def validate_financial_plan(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Validates a financial/GTM plan artifact. Checks:
    - gtm_channels exist with weekly_hours and expected_cac
    - financial_plan with MRR ramp monotonicity and breakeven sanity
    """
    results = {
        "checks": {},
        "score": 0,
        "feedback": []
    }

    # GTM channels check
    channels = data.get("gtm_channels", [])
    if isinstance(channels, list) and len(channels) >= 3:
        results["checks"]["has_channels"] = True
        results["score"] += 20
        valid_channels = sum(
            1 for ch in channels
            if isinstance(ch, dict) and "weekly_hours" in ch and "expected_cac_usd" in ch
        )
        if valid_channels >= 3:
            results["checks"]["channels_well_formed"] = True
            results["score"] += 15
        else:
            results["checks"]["channels_well_formed"] = False
            results["feedback"].append("Some channels missing weekly_hours or expected_cac_usd.")
    else:
        results["checks"]["has_channels"] = False
        results["feedback"].append("Need at least 3 GTM channels.")

    # Financial plan check
    fp = data.get("financial_plan", {})
    if not isinstance(fp, dict):
        results["checks"]["has_financial_plan"] = False
        results["feedback"].append("Missing financial_plan object.")
    else:
        results["checks"]["has_financial_plan"] = True
        results["score"] += 15

        # MRR ramp: look for any list of numbers
        mrr_values = None
        for k, v in fp.items():
            if "mrr" in k.lower() and isinstance(v, list) and len(v) >= 4:
                mrr_values = v
                break

        if mrr_values:
            nums = [x for x in mrr_values if isinstance(x, (int, float))]
            if len(nums) >= 4:
                is_monotonic = all(nums[i] <= nums[i + 1] for i in range(len(nums) - 1))
                if is_monotonic:
                    results["checks"]["mrr_monotonic"] = True
                    results["score"] += 20
                else:
                    results["checks"]["mrr_monotonic"] = False
                    results["feedback"].append("MRR ramp should be monotonically increasing.")
            else:
                results["checks"]["mrr_monotonic"] = False
                results["feedback"].append(f"MRR ramp has too few numeric entries ({len(nums)}).")
        else:
            results["checks"]["mrr_monotonic"] = False
            results["feedback"].append("Missing MRR ramp array in financial_plan.")

        be = fp.get("breakeven_month")
        if isinstance(be, (int, float)) and 1 <= be <= 24:
            results["checks"]["breakeven_sane"] = True
            results["score"] += 15
        elif be is not None:
            results["checks"]["breakeven_sane"] = False
            results["feedback"].append(f"Breakeven month ({be}) outside sane range 1-24.")

        burn = fp.get("burn_usd_per_month")
        if isinstance(burn, (int, float)) and burn >= 0:
            results["checks"]["burn_present"] = True
            results["score"] += 15
        else:
            results["checks"]["burn_present"] = False
            results["feedback"].append("Missing or invalid burn_usd_per_month.")

    success = results["score"] >= 70
    return success, results


def validate_org_chart(data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """Validates an org chart / OKR artifact."""
    results = {
        "checks": {},
        "score": 0,
        "feedback": []
    }

    org = data.get("org_chart", [])
    if isinstance(org, list) and len(org) >= 1:
        results["checks"]["has_org_chart"] = True
        results["score"] += 30
        roles = [r.get("role", "").lower() for r in org if isinstance(r, dict)]
        if any("founder" in r for r in roles):
            results["checks"]["has_founder"] = True
            results["score"] += 20
        else:
            results["checks"]["has_founder"] = False
            results["feedback"].append("Org chart should include a Founder role.")
    else:
        results["checks"]["has_org_chart"] = False
        results["feedback"].append("Missing org_chart array.")

    okrs = data.get("okrs_q1", data.get("okrs", []))
    if isinstance(okrs, list) and len(okrs) >= 1:
        results["checks"]["has_okrs"] = True
        results["score"] += 30
        has_krs = any(
            isinstance(o, dict) and isinstance(o.get("key_results"), list) and len(o["key_results"]) >= 2
            for o in okrs
        )
        if has_krs:
            results["checks"]["okrs_have_key_results"] = True
            results["score"] += 20
        else:
            results["checks"]["okrs_have_key_results"] = False
            results["feedback"].append("OKRs should have at least 2 key results each.")
    else:
        results["checks"]["has_okrs"] = False
        results["feedback"].append("Missing OKRs.")

    success = results["score"] >= 70
    return success, results
