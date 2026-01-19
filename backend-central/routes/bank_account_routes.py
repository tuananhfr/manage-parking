"""
Bank Account API Routes
Handle bank account configuration and payment integration
"""
from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List
import httpx
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/bank-account", tags=["bank-account"])

# Cache for bank list
_bank_list_cache = None
_bank_list_cache_time = None
CACHE_DURATION = timedelta(hours=24)  # Cache for 24 hours


@router.get("/info")
async def get_bank_account_info() -> Dict[str, Any]:
    """
    Get configured bank account information
    Used by other modules to retrieve bank account details for payment QR generation

    Returns:
        Bank account info including account number, name, bank code, etc.
    """
    try:
        import config

        bank_code = config.BANK_CODE if hasattr(config, "BANK_CODE") else ""
        account_number = config.BANK_ACCOUNT_NUMBER if hasattr(config, "BANK_ACCOUNT_NUMBER") else ""
        account_name = config.BANK_ACCOUNT_NAME if hasattr(config, "BANK_ACCOUNT_NAME") else ""
        bank_name = config.BANK_NAME if hasattr(config, "BANK_NAME") else ""
        description_prefix = config.DESCRIPTION_PREFIX if hasattr(config, "DESCRIPTION_PREFIX") else "Chuyển tiền"

        # Check if bank account is configured
        if not account_number or not bank_code:
            return {
                "success": False,
                "configured": False,
                "message": "Bank account not configured"
            }

        return {
            "success": True,
            "configured": True,
            "data": {
                "account_number": account_number,
                "account_name": account_name,
                "bank_name": bank_name,
                "bank_code": bank_code,
                "description_prefix": description_prefix
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/banks")
async def get_bank_list() -> Dict[str, Any]:
    """
    Get list of Vietnamese banks from VietQR API
    Returns cached data if available (24h cache)
    """
    global _bank_list_cache, _bank_list_cache_time

    # Check cache
    if _bank_list_cache and _bank_list_cache_time:
        if datetime.now() - _bank_list_cache_time < CACHE_DURATION:
            return {
                "success": True,
                "data": _bank_list_cache,
                "cached": True,
                "cache_time": _bank_list_cache_time.isoformat()
            }

    try:
        # Fetch from VietQR API
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("https://api.vietqr.io/v2/banks")
            response.raise_for_status()
            data = response.json()

            if data.get("code") == "00" and "data" in data:
                banks = data["data"]

                # Transform to our format
                bank_list = [
                    {
                        "id": bank["id"],
                        "code": bank["code"],
                        "name": bank["name"],
                        "shortName": bank.get("shortName", bank["name"]),
                        "logo": bank.get("logo", ""),
                        "bin": bank.get("bin", "")
                    }
                    for bank in banks
                ]

                # Update cache
                _bank_list_cache = bank_list
                _bank_list_cache_time = datetime.now()

                return {
                    "success": True,
                    "data": bank_list,
                    "cached": False
                }
            else:
                raise HTTPException(status_code=500, detail="Invalid response from VietQR API")

    except httpx.TimeoutException:
        # Return cached data if available, even if expired
        if _bank_list_cache:
            return {
                "success": True,
                "data": _bank_list_cache,
                "cached": True,
                "warning": "Using cached data due to timeout"
            }
        raise HTTPException(status_code=504, detail="Timeout fetching bank list")

    except httpx.HTTPError as e:
        # Return cached data if available
        if _bank_list_cache:
            return {
                "success": True,
                "data": _bank_list_cache,
                "cached": True,
                "warning": f"Using cached data due to error: {str(e)}"
            }
        raise HTTPException(status_code=503, detail=f"Error fetching bank list: {str(e)}")

    except Exception as e:
        if _bank_list_cache:
            return {
                "success": True,
                "data": _bank_list_cache,
                "cached": True,
                "warning": f"Using cached data due to error: {str(e)}"
            }
        raise HTTPException(status_code=500, detail=str(e))




@router.get("/qr-code")
async def get_qr_code(amount: int, description: str) -> Dict[str, Any]:
    """
    Generate QR code data for bank transfer

    Args:
        amount: Payment amount in VND
        description: Transfer description (usually license plate)

    Returns:
        QR code data URL or bank transfer info
    """
    try:
        import config

        # Generate VietQR-compatible data
        # Format: https://img.vietqr.io/image/{BANK_CODE}-{ACCOUNT_NUMBER}-{TEMPLATE}.jpg?amount={AMOUNT}&addInfo={DESCRIPTION}

        bank_code = config.BANK_CODE if hasattr(config, "BANK_CODE") else ""
        account_number = config.BANK_ACCOUNT_NUMBER if hasattr(config, "BANK_ACCOUNT_NUMBER") else ""
        account_name = config.BANK_ACCOUNT_NAME if hasattr(config, "BANK_ACCOUNT_NAME") else ""
        bank_name = config.BANK_NAME if hasattr(config, "BANK_NAME") else ""

        if not bank_code or not account_number:
            raise HTTPException(status_code=400, detail="Bank account info incomplete")

        # VietQR URL
        qr_url = f"https://img.vietqr.io/image/{bank_code}-{account_number}-compact.jpg?amount={amount}&addInfo={description}"

        return {
            "success": True,
            "qr_url": qr_url,
            "bank_info": {
                "bank_name": bank_name,
                "bank_code": bank_code,
                "account_number": account_number,
                "account_name": account_name,
                "amount": amount,
                "description": description
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
