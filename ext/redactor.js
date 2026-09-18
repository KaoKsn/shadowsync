(function () {
    "use strict";

    /*
    ============================================================
                       DOM PII REDACTOR
    ============================================================

    FEATURES

    - Redacts PII values
    - Preserves h1-h6
    - Preserves header
    - Preserves legend
    - Preserves field labels
    - Preserves placeholders
    - Redacts field values
    - Redacts dates
    - Redacts DOB
    - Redacts father name
    - Redacts mother's name
    - Redacts phone numbers
    - Redacts emails
    - Redacts Aadhaar
    - Redacts PAN
    - Redacts IFSC
    - Redacts bank details
    - Redacts card numbers
    - Redacts identifiers
    - Redacts addresses
    - Redacts vehicle information
    - Redacts digital identifiers

    ============================================================
    */

    /* =========================================================
       CONFIGURATION
       ========================================================= */

    const CONFIG = {

        replacement:
            "[REDACTED]",

        aggressive:
            true,

        scanText:
            true,

        scanFieldValues:
            true,

        scanForms:
            true,

        scanAttributes:
            true,

        scanDataset:
            true,

        scanURLs:
            true,

        scanComments:
            true,

        scanMeta:
            true,

        scanAccessibility:
            true,

        scanStyles:
            true
    };


    /* =========================================================
       PII LABEL DATABASE
       ========================================================= */

    const PII_LABELS = {

        /* =====================================================
           IDENTITY
           ===================================================== */

        name: [

            "name",
            "full name",
            "fullname",

            "first name",
            "firstname",

            "given name",

            "middle name",

            "last name",
            "lastname",
            "surname",
            "family name",

            "legal name",
            "display name",
            "preferred name",
            "nickname",

            "person name",
            "personal name",

            "customer name",
            "client name",
            "patient name",
            "employee name",
            "student name",

            "applicant name",
            "candidate name",

            "account holder",
            "account holder name",

            "beneficiary name",
            "recipient name",
            "sender name",

            "card holder",
            "cardholder",
            "card holder name",

            "name on card"
        ],


        customer_id: [

            "customer id",
            "customer number",
            "customer no",

            "client id",
            "client number",

            "user id",
            "user identifier",

            "profile id",
            "profile number"
        ],


        /* =====================================================
           CONTACT
           ===================================================== */

        email: [

            "email",
            "email address",

            "e-mail",
            "e-mail address",

            "personal email",
            "work email",
            "business email",

            "alternate email",
            "secondary email",

            "primary email"
        ],


        phone: [

            "phone",
            "phone number",

            "mobile",
            "mobile number",

            "telephone",
            "telephone number",

            "contact number",
            "contact phone",

            "cell",
            "cell number",

            "landline",

            "fax",
            "fax number",

            "whatsapp number",

            "emergency phone",
            "emergency contact number",

            "nominee phone"
        ],


        /* =====================================================
           ADDRESS
           ===================================================== */

        address: [

            "address",

            "home address",
            "residential address",
            "permanent address",
            "current address",
            "temporary address",

            "mailing address",
            "postal address",

            "billing address",
            "shipping address",

            "office address",
            "work address",

            "registered address",
            "delivery address",

            "residential"
        ],


        house: [

            "house number",
            "house no",

            "door number",
            "door no",

            "flat number",
            "flat no",

            "apartment",
            "apartment number",

            "unit number",
            "unit no",

            "building number",
            "building no",

            "plot number",
            "plot no"
        ],


        street: [

            "street",
            "street name",

            "road",
            "road name",

            "lane",
            "lane name",

            "avenue",
            "avenue name",

            "boulevard",

            "highway"
        ],


        locality: [

            "locality",
            "neighborhood",
            "neighbourhood",

            "area",

            "district",

            "town",
            "town name",

            "village",

            "suburb",

            "municipality",

            "layout"
        ],


        city: [

            "city",
            "city name",

            "residence city",

            "birth city",

            "hometown"
        ],


        state: [

            "state",
            "state name",

            "province",
            "province name",

            "region"
        ],


        country: [

            "country",
            "country name",

            "residence country",

            "birth country"
        ],


        postal: [

            "zip",
            "zip code",
            "zipcode",

            "postal code",
            "postcode",
            "post code",

            "pin code",
            "pincode"
        ],


        landmark: [

            "landmark",

            "nearby landmark",

            "directions",

            "location details"
        ],


        /* =====================================================
           DATE / DEMOGRAPHICS
           ===================================================== */

        date: [

            "date",

            "dob",

            "date of birth",

            "birth date",

            "birthdate",

            "born on",

            "birthday",

            "date of joining",

            "joining date",

            "admission date",

            "registration date",

            "issue date",

            "expiry date",

            "expiration date",

            "start date",

            "end date",

            "appointment date"
        ],


        dob: [

            "dob",

            "date of birth",

            "birth date",

            "birthdate",

            "born on",

            "birthday"
        ],


        age: [

            "age",
            "age range"
        ],


        gender: [

            "gender",

            "sex",

            "gender identity",

            "gender expression"
        ],


        nationality: [

            "nationality",

            "citizenship",

            "citizenship status",

            "residency status",

            "resident status",

            "immigration status",

            "visa status"
        ],


        marital: [

            "marital status",

            "marriage status",

            "relationship status",

            "spouse",

            "partner"
        ],


        /* =====================================================
           GOVERNMENT IDS
           ===================================================== */

        aadhaar: [

            "aadhaar",

            "aadhar",

            "aadhaar number",

            "aadhar number",

            "uid",

            "uidai"
        ],


        pan: [

            "pan",

            "pan number",

            "permanent account number"
        ],


        voter: [

            "voter id",

            "voter id number",

            "voter number",

            "epic",

            "epic number"
        ],


        passport: [

            "passport",

            "passport number",

            "passport no"
        ],


        driving_license: [

            "driving license",

            "driving licence",

            "driver license",

            "driver's license",

            "dl number",

            "license number",

            "licence number"
        ],


        government_id: [

            "government id",

            "government identification",

            "national id",

            "national identification",

            "identity number",

            "identification number",

            "id number"
        ],


        tax: [

            "tax id",

            "tax number",

            "tax identification",

            "tax identification number",

            "tin",

            "gstin",

            "gst number",

            "taxpayer id"
        ],


        social_security: [

            "social security",

            "social security number",

            "ssn"
        ],


        /* =====================================================
           BANKING
           ===================================================== */

        bank_account: [

            "account number",

            "account no",

            "bank account",

            "bank account number",

            "savings account",

            "current account",

            "account id",

            "account identifier"
        ],


        ifsc: [

            "ifsc",

            "ifsc code",

            "bank ifsc"
        ],


        micr: [

            "micr",

            "micr code",

            "micr number"
        ],


        iban: [

            "iban",

            "international bank account number"
        ],


        swift: [

            "swift",

            "swift code",

            "bic",

            "bic code"
        ],


        routing: [

            "routing number",

            "routing code",

            "sort code",

            "bank routing"
        ],


        branch: [

            "branch",

            "branch name",

            "bank branch",

            "branch address",

            "home branch"
        ],


        upi: [

            "upi",

            "upi id",

            "upi identifier",

            "upi address",

            "vpa",

            "virtual payment address"
        ],


        /* =====================================================
           PAYMENT CARD
           ===================================================== */

        card_number: [

            "card number",

            "credit card",

            "credit card number",

            "debit card",

            "debit card number",

            "payment card",

            "payment card number"
        ],


        card_holder: [

            "card holder",

            "cardholder",

            "card holder name",

            "name on card"
        ],


        cvv: [

            "cvv",

            "cvv2",

            "cvc",

            "security code",

            "card security code"
        ],


        expiry: [

            "expiry",

            "expiration",

            "expiry date",

            "expiration date",

            "valid thru",

            "valid through",

            "expires",

            "expiration month",

            "expiration year"
        ],


        card_type: [

            "card type",

            "payment type"
        ],


        /* =====================================================
           FINANCIAL
           ===================================================== */

        financial: [

            "balance",

            "bank balance",

            "account balance",

            "available balance",

            "current balance",

            "credit limit",

            "available credit",

            "statement due",

            "minimum due",

            "amount due",

            "outstanding amount",

            "transaction amount",

            "transaction value",

            "salary",

            "annual salary",

            "monthly salary",

            "income",

            "annual income",

            "monthly income",

            "gross income",

            "net income",

            "compensation",

            "pay",

            "net worth",

            "assets",

            "liabilities",

            "investment",

            "investments",

            "portfolio",

            "loan",

            "loan number",

            "mortgage",

            "mortgage number",

            "credit score",

            "credit history",

            "payment amount",

            "purchase amount"
        ],


        /* =====================================================
           AUTHENTICATION
           ===================================================== */

        password: [

            "password",

            "passwd",

            "passcode",

            "login password",

            "account password"
        ],


        otp: [

            "otp",

            "one time password",

            "one-time password",

            "verification code",

            "authentication code",

            "verification otp"
        ],


        pin: [

            "pin",

            "pin number",

            "personal identification number",

            "atm pin",

            "card pin",

            "debit pin"
        ],


        secret: [

            "secret",

            "secret answer",

            "security answer",

            "recovery code",

            "backup code"
        ],


        /* =====================================================
           DIGITAL IDENTIFIERS
           ===================================================== */

        api_key: [

            "api key",

            "apikey",

            "api token",

            "access token",

            "auth token",

            "authentication token",

            "bearer token",

            "refresh token",

            "secret key",

            "private key",

            "client secret"
        ],


        session: [

            "session id",

            "session token",

            "session identifier",

            "cookie",

            "cookie value"
        ],


        device: [

            "device id",

            "device identifier",

            "device number",

            "imei",

            "imei number",

            "serial number",

            "serial",

            "mac address",

            "bluetooth address"
        ],


        ip: [

            "ip",

            "ip address",

            "ipv4",

            "ipv6",

            "public ip",

            "private ip"
        ],


        fingerprint: [

            "fingerprint",

            "browser fingerprint",

            "device fingerprint",

            "biometric fingerprint"
        ],


        /* =====================================================
           EMPLOYMENT
           ===================================================== */

        employment: [

            "employee id",

            "employee number",

            "employee code",

            "staff id",

            "staff number",

            "worker id",

            "job title",

            "designation",

            "department",

            "employer",

            "company name",

            "organization",

            "office",

            "workplace"
        ],


        employment_details: [

            "joining date",

            "hire date",

            "employment date",

            "termination date",

            "employee status",

            "employment status",

            "work location",

            "manager",

            "manager name",

            "supervisor",

            "supervisor name"
        ],


        /* =====================================================
           EDUCATION
           ===================================================== */

        education: [

            "student id",

            "student number",

            "student code",

            "roll number",

            "roll no",

            "registration number",

            "registration no",

            "university id",

            "college id",

            "admission number",

            "enrollment number",

            "enrolment number",

            "candidate id"
        ],


        academic: [

            "gpa",

            "cgpa",

            "grade",

            "marks",

            "score",

            "percentage",

            "rank",

            "academic record",

            "transcript",

            "academic history"
        ],


        /* =====================================================
           MEDICAL
           ===================================================== */

        medical: [

            "medical record",

            "medical record number",

            "patient id",

            "patient number",

            "patient name",

            "hospital id",

            "hospital number",

            "health id",

            "health record",

            "medical history",

            "diagnosis",

            "condition",

            "disease",

            "illness",

            "treatment",

            "medication",

            "prescription",

            "doctor name",

            "physician name"
        ],


        blood: [

            "blood group",

            "blood type",

            "rh factor"
        ],


        insurance: [

            "insurance number",

            "insurance id",

            "policy number",

            "policy id",

            "claim number",

            "claim id"
        ],


        /* =====================================================
           FAMILY
           ===================================================== */

        family: [

            "father name",

            "father's name",

            "fathers name",

            "father full name",

            "father fullname",

            "mother name",

            "mother's name",

            "mothers name",

            "mother full name",

            "mother fullname",

            "parent name",

            "parent's name",

            "parents name",

            "guardian name",

            "guardian's name",

            "spouse name",

            "partner name",

            "child name",

            "son name",

            "daughter name",

            "brother name",

            "sister name",

            "nominee",

            "nominee name",

            "nominee phone",

            "emergency contact",

            "emergency contact name"
        ],


        /* =====================================================
           TRAVEL
           ===================================================== */

        travel: [

            "passport",

            "visa",

            "visa number",

            "flight number",

            "booking number",

            "booking id",

            "reservation number",

            "reservation id",

            "ticket number",

            "ticket id",

            "pnr",

            "pnr number",

            "train number",

            "bus number",

            "hotel booking",

            "travel history"
        ],


        /* =====================================================
           VEHICLE
           ===================================================== */

        vehicle: [

            "vehicle number",

            "vehicle registration",

            "registration plate",

            "license plate",

            "licence plate",

            "number plate",

            "vin",

            "vin number",

            "vehicle identification number",

            "chassis number",

            "engine number"
        ],


        /* =====================================================
           LOCATION
           ===================================================== */

        location: [

            "gps",

            "gps location",

            "latitude",

            "longitude",

            "coordinates",

            "geolocation",

            "location",

            "current location",

            "home location",

            "work location",

            "location history"
        ],


        /* =====================================================
           SOCIAL
           ===================================================== */

        social: [

            "facebook id",

            "instagram id",

            "twitter id",

            "twitter username",

            "x username",

            "linkedin id",

            "linkedin profile",

            "github username",

            "social media",

            "social media handle",

            "social handle"
        ],


        /* =====================================================
           ONLINE ACTIVITY
           ===================================================== */

        online_activity: [

            "search history",

            "browsing history",

            "browser history",

            "website history",

            "click history",

            "activity history",

            "login history",

            "ip history"
        ],


        /* =====================================================
           PURCHASE
           ===================================================== */

        purchases: [

            "purchase history",

            "order history",

            "order number",

            "order id",

            "invoice number",

            "invoice id",

            "receipt number",

            "receipt id"
        ]
    };


    /* =========================================================
       REGEX PATTERNS
       ========================================================= */

    const PATTERNS = [

        /* EMAIL */

        {
            type:
                "EMAIL",

            regex:
                /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
        },


        /* INDIA PHONE */

        {
            type:
                "PHONE",

            regex:
                /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g
        },


        /* AADHAAR */

        {
            type:
                "AADHAAR",

            regex:
                /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g
        },


        /* PAN */

        {
            type:
                "PAN",

            regex:
                /\b[A-Z]{5}\d{4}[A-Z]\b/gi
        },


        /* IFSC */

        {
            type:
                "IFSC",

            regex:
                /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi
        },


        /* IBAN */

        {
            type:
                "IBAN",

            regex:
                /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi
        },


        /* SSN */

        {
            type:
                "SSN",

            regex:
                /\b\d{3}-\d{2}-\d{4}\b/g
        },


        /* VIN */

        {
            type:
                "VIN",

            regex:
                /\b[A-HJ-NPR-Z0-9]{17}\b/gi
        },


        /* IMEI */

        {
            type:
                "IMEI",

            regex:
                /\b\d{15}\b/g
        },


        /* IPV4 */

        {
            type:
                "IP",

            regex:
                /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
        },


        /* IPV6 */

        {
            type:
                "IPV6",

            regex:
                /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi
        },


        /* MAC */

        {
            type:
                "MAC",

            regex:
                /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi
        },


        /* JWT */

        {
            type:
                "JWT",

            regex:
                /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
        },


        /* BEARER TOKEN */

        {
            type:
                "BEARER_TOKEN",

            regex:
                /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi
        },


        /* API KEY */

        {
            type:
                "API_KEY",

            regex:
                /\b(?:sk|pk|api|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi
        },


        /* AWS */

        {
            type:
                "AWS_KEY",

            regex:
                /\bAKIA[0-9A-Z]{16}\b/g
        },


        /* UUID */

        {
            type:
                "UUID",

            regex:
                /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
        },


        /*
           DATE

           Examples:

           17/09/2003
           17-09-2003
           17.09.2003

           2003-09-17

           17 September 2003
           17 September, 2003

           September 17 2003
           September 17, 2003
        */

        {
            type:
                "DATE",

            regex:
                /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi
        },


        /* COORDINATES */

        {
            type:
                "COORDINATES",

            regex:
                /[-+]?\d{1,3}\.\d{3,}\s*[,;]\s*[-+]?\d{1,3}\.\d{3,}/g
        }
    ];


    /* =========================================================
       SENSITIVE DATA ATTRIBUTES
       ========================================================= */

    const SENSITIVE_ATTRIBUTES =
        new Set([

            "data-name",
            "data-full-name",
            "data-first-name",
            "data-last-name",

            "data-father-name",
            "data-mother-name",
            "data-parent-name",

            "data-email",
            "data-phone",
            "data-mobile",

            "data-address",
            "data-street",
            "data-city",
            "data-state",
            "data-country",

            "data-pincode",
            "data-postal-code",

            "data-date",
            "data-dob",
            "data-birth-date",

            "data-aadhaar",
            "data-aadhar",

            "data-pan",

            "data-passport",

            "data-voter-id",

            "data-driving-license",
            "data-driving-licence",

            "data-account-number",
            "data-bank-account",

            "data-ifsc",
            "data-iban",
            "data-swift",
            "data-upi",

            "data-card-number",
            "data-card-holder",

            "data-cvv",
            "data-expiry",

            "data-password",
            "data-pin",
            "data-otp",

            "data-api-key",
            "data-token",
            "data-secret",

            "data-session-id",

            "data-ip",
            "data-imei",

            "data-device-id",
            "data-serial-number",

            "data-employee-id",
            "data-student-id",
            "data-roll-number",

            "data-patient-id",
            "data-medical-record",

            "data-vehicle-number",
            "data-vin",

            "data-latitude",
            "data-longitude",

            "data-location",

            "data-nominee"
        ]);


    /* =========================================================
       PROTECTED ELEMENTS
       ========================================================= */

    const PROTECTED_SELECTOR =
        "h1,h2,h3,h4,h5,h6,header,legend";


    const EXECUTABLE_SELECTOR =
        "script,style,noscript,template";


    const LABEL_SELECTOR =
        "label,.label,.field-label,.form-label,.input-label,.field-name,.field-title";


    /* =========================================================
       BASIC HELPERS
       ========================================================= */

    function normalize(
        value
    ) {

        return String(
            value == null
                ? ""
                : value
        )
            .toLowerCase()
            .replace(
                /[_-]+/g,
                " "
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim();
    }


    function replacement() {

        return CONFIG.replacement;
    }


    function increment(
        stats,
        type
    ) {

        stats.total++;


        if (
            !stats.byType[type]
        ) {

            stats.byType[type] =
                0;
        }


        stats.byType[type]++;
    }


    /* =========================================================
       PROTECTION
       ========================================================= */

    function isProtectedElement(
        element
    ) {

        if (
            !element ||
            element.nodeType !== 1
        ) {

            return false;
        }


        if (
            !element.closest
        ) {

            return false;
        }


        return !!element.closest(
            PROTECTED_SELECTOR
        );
    }


    function isProtectedTextNode(
        node
    ) {

        if (!node) {
            return false;
        }


        const parent =
            node.parentElement;


        if (!parent) {
            return false;
        }


        return isProtectedElement(
            parent
        );
    }


    function isExecutableElement(
        element
    ) {

        if (
            !element ||
            !element.matches
        ) {

            return false;
        }


        return element.matches(
            EXECUTABLE_SELECTOR
        );
    }


    function isInsideLabelElement(
        element
    ) {

        if (
            !element ||
            !element.closest
        ) {

            return false;
        }


        return !!element.closest(
            LABEL_SELECTOR
        );
    }


    /* =========================================================
       PII LABEL DETECTION
       ========================================================= */

    function findPIILabel(
        text
    ) {

        const normalized =
            normalize(text);


        if (!normalized) {
            return null;
        }


        /*
           Exact match first.
        */

        for (
            const category
            of Object.keys(
                PII_LABELS
            )
        ) {

            for (
                const label
                of PII_LABELS[
                    category
                ]
            ) {

                if (
                    normalized ===
                    normalize(label)
                ) {

                    return {

                        category:
                            category.toUpperCase(),

                        label:
                            label
                    };
                }
            }
        }


        /*
           Partial match.
        */

        for (
            const category
            of Object.keys(
                PII_LABELS
            )
        ) {

            for (
                const label
                of PII_LABELS[
                    category
                ]
            ) {

                const normalizedLabel =
                    normalize(label);


                if (
                    normalizedLabel.length >= 4 &&

                    normalized.includes(
                        normalizedLabel
                    )
                ) {

                    return {

                        category:
                            category.toUpperCase(),

                        label:
                            label
                    };
                }
            }
        }


        return null;
    }


    /* =========================================================
       LABEL ELEMENT DETECTION
       ========================================================= */

    function isPIILabelElement(
        element
    ) {

        if (!element) {
            return false;
        }


        /*
           Headings are NEVER labels.
        */

        if (
            isProtectedElement(
                element
            )
        ) {

            return false;
        }


        /*
           Form controls are values.
        */

        if (
            element.matches &&

            element.matches(
                "input,textarea,select,option,button"
            )
        ) {

            return false;
        }


        const text =
            String(
                element.textContent ||
                ""
            )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


        if (
            !text ||
            text.length > 100
        ) {

            return false;
        }


        /*
           Exact label match only.
        */

        let exactMatch =
            false;


        for (
            const category
            of Object.keys(
                PII_LABELS
            )
        ) {

            for (
                const label
                of PII_LABELS[
                    category
                ]
            ) {

                if (
                    normalize(label) ===
                    normalize(text)
                ) {

                    exactMatch =
                        true;

                    break;
                }
            }


            if (exactMatch) {
                break;
            }
        }


        if (!exactMatch) {
            return false;
        }


        /*
           HTML label.
        */

        if (
            element.tagName &&

            element.tagName.toLowerCase() ===
                "label"
        ) {

            return true;
        }


        /*
           Label classes.
        */

        const className =
            typeof element.className ===
                "string"
                ? normalize(
                    element.className
                )
                : "";


        if (
            /(^|\s)(label|field-label|form-label|input-label|field-name|field-title)(\s|$)/i
                .test(
                    className
                )
        ) {

            return true;
        }


        /*
           Semantic label attributes.
        */

        if (
            element.hasAttribute(
                "data-label"
            ) ||

            element.hasAttribute(
                "data-field"
            )
        ) {

            return true;
        }


        /*
           Leaf element.
        */

        if (
            element.children &&

            element.children.length === 0
        ) {

            return true;
        }


        return false;
    }


    /* =========================================================
       CONTEXT
       ========================================================= */

    function getContext(
        element
    ) {

        if (!element) {
            return "";
        }


        const parts = [

            element.tagName ||
                "",

            element.id ||
                "",

            typeof element.className ===
                "string"
                ? element.className
                : ""
        ];


        /*
           PLACEHOLDER IS DELIBERATELY EXCLUDED.
        */

        const attributes = [

            "name",

            "aria-label",

            "title",

            "data-label",

            "data-field",

            "data-name"
        ];


        for (
            const attribute
            of attributes
        ) {

            const value =
                element.getAttribute(
                    attribute
                );


            if (value) {

                parts.push(
                    value
                );
            }
        }


        return normalize(
            parts.join(" ")
        );
    }


    /* =========================================================
       LUHN
       ========================================================= */

    function passesLuhn(
        value
    ) {

        const digits =
            String(value)
                .replace(
                    /\D/g,
                    ""
                );


        if (
            digits.length < 13 ||
            digits.length > 19
        ) {

            return false;
        }


        let sum =
            0;


        let alternate =
            false;


        for (
            let i =
                digits.length - 1;

            i >= 0;

            i--
        ) {

            let number =
                Number(
                    digits[i]
                );


            if (alternate) {

                number *= 2;


                if (
                    number > 9
                ) {

                    number -= 9;
                }
            }


            sum +=
                number;


            alternate =
                !alternate;
        }


        return (
            sum % 10 === 0
        );
    }


    /* =========================================================
       CARD REDACTION
       ========================================================= */

    function redactCards(
        text,
        stats
    ) {

        return text.replace(

            /\b(?:\d[ -]?){13,19}\b/g,

            function (match) {

                if (
                    !passesLuhn(
                        match
                    )
                ) {

                    return match;
                }


                increment(
                    stats,
                    "CARD"
                );


                return replacement();
            }
        );
    }


    /* =========================================================
       PATTERN REDACTION
       ========================================================= */

    function redactPatterns(
        text,
        stats
    ) {

        let result =
            text;


        for (
            const pattern
            of PATTERNS
        ) {

            pattern.regex.lastIndex =
                0;


            result =
                result.replace(

                    pattern.regex,

                    function () {

                        increment(
                            stats,
                            pattern.type
                        );


                        return replacement();
                    }
                );
        }


        return result;
    }


    /* =========================================================
       NAME HEURISTIC
       ========================================================= */

    function redactNames(
        text,
        context,
        stats
    ) {

        if (
            !CONFIG.aggressive
        ) {

            return text;
        }


        const lower =
            normalize(
                context
            );


        const indicators = [

            "name",

            "customer",

            "patient",

            "employee",

            "student",

            "applicant",

            "candidate",

            "account holder",

            "beneficiary",

            "recipient",

            "sender",

            "nominee",

            "card holder",

            "cardholder",

            "manager",

            "supervisor",

            "father",

            "mother",

            "parent",

            "guardian"
        ];


        let nameContext =
            false;


        for (
            const indicator
            of indicators
        ) {

            if (
                lower.includes(
                    normalize(
                        indicator
                    )
                )
            ) {

                nameContext =
                    true;

                break;
            }
        }


        if (!nameContext) {
            return text;
        }


        const regex =
            /\b[A-Z][a-z]{1,30}(?:\s+[A-Z][a-z]{1,30}){1,3}\b/g;


        const ignored =
            new Set([

                "Full Name",

                "First Name",

                "Last Name",

                "Card Holder",

                "Account Holder",

                "Credit Card",

                "Debit Card",

                "Date Of Birth",

                "Customer Name",

                "Patient Name",

                "Employee Name",

                "Student Name",

                "Father Name",

                "Father's Name",

                "Mother Name",

                "Mother's Name",

                "Parent Name",

                "Guardian Name"
            ]);


        return text.replace(

            regex,

            function (match) {

                if (
                    ignored.has(
                        match
                    )
                ) {

                    return match;
                }


                increment(
                    stats,
                    "NAME"
                );


                return replacement();
            }
        );
    }


    /* =========================================================
       ADDRESS HEURISTIC
       ========================================================= */

    function redactAddresses(
        text,
        context,
        stats
    ) {

        const lower =
            normalize(
                context
            );


        const indicators = [

            "address",

            "street",

            "road",

            "avenue",

            "lane",

            "house",

            "flat",

            "apartment",

            "building",

            "locality",

            "city",

            "state",

            "postal",

            "pincode",

            "zip"
        ];


        let addressContext =
            false;


        for (
            const indicator
            of indicators
        ) {

            if (
                lower.includes(
                    normalize(
                        indicator
                    )
                )
            ) {

                addressContext =
                    true;

                break;
            }
        }


        if (!addressContext) {
            return text;
        }


        const regex =
            /\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .,'\/-]{2,100}\b/g;


        return text.replace(

            regex,

            function (match) {

                if (
                    !/[A-Za-z]/.test(
                        match
                    )
                ) {

                    return match;
                }


                increment(
                    stats,
                    "ADDRESS"
                );


                return replacement();
            }
        );
    }


    /* =========================================================
       NORMAL TEXT SANITIZER
       ========================================================= */

    function sanitizeText(
        text,
        context,
        stats
    ) {

        if (
            !text ||
            !text.trim()
        ) {

            return text;
        }


        let result =
            text;


        result =
            redactPatterns(
                result,
                stats
            );


        result =
            redactCards(
                result,
                stats
            );


        result =
            redactNames(
                result,
                context,
                stats
            );


        result =
            redactAddresses(
                result,
                context,
                stats
            );


        return result;
    }


    /* =========================================================
       FIELD CONTAINER
       ========================================================= */

    function findFieldContainer(
        labelElement
    ) {

        if (!labelElement) {
            return null;
        }


        let current =
            labelElement.parentElement;


        let depth =
            0;


        while (
            current &&
            depth < 6
        ) {

            if (
                isProtectedElement(
                    current
                )
            ) {

                return null;
            }


            const children =
                Array.from(
                    current.children
                );


            if (
                children.length >= 2 &&
                children.length <= 8
            ) {

                const directLabel =
                    children.indexOf(
                        labelElement
                    );


                if (
                    directLabel !== -1
                ) {

                    return current;
                }


                const nestedLabel =
                    children.some(
                        function (child) {

                            return child.contains(
                                labelElement
                            );
                        }
                    );


                if (nestedLabel) {

                    return current;
                }
            }


            current =
                current.parentElement;


            depth++;
        }


        return null;
    }


    /* =========================================================
       FIELD VALUE NODES
       ========================================================= */

    function getFieldValueNodes(
        container,
        labelElement
    ) {

        const result =
            [];


        if (
            !container ||
            !labelElement
        ) {

            return result;
        }


        const labelTextNodes =
            new Set();


        const labelWalker =
            document.createTreeWalker(

                labelElement,

                NodeFilter.SHOW_TEXT
            );


        let labelNode;


        while (
            (
                labelNode =
                    labelWalker.nextNode()
            )
        ) {

            labelTextNodes.add(
                labelNode
            );
        }


        const descendants =
            Array.from(
                container.querySelectorAll("*")
            );


        for (
            const element
            of descendants
        ) {

            /*
               Never inspect label.
            */

            if (
                element ===
                labelElement
            ) {

                continue;
            }


            /*
               Never inspect label subtree.
            */

            if (
                labelElement.contains(
                    element
                )
            ) {

                continue;
            }


            /*
               Never inspect protected elements.
            */

            if (
                isProtectedElement(
                    element
                )
            ) {

                continue;
            }


            /*
               Never inspect another label.
            */

            if (
                isPIILabelElement(
                    element
                )
            ) {

                continue;
            }


            /*
               Only leaf elements.
            */

            if (
                element.children.length !==
                0
            ) {

                continue;
            }


            const walker =
                document.createTreeWalker(

                    element,

                    NodeFilter.SHOW_TEXT
                );


            let node;


            while (
                (
                    node =
                        walker.nextNode()
                )
            ) {

                if (
                    labelTextNodes.has(
                        node
                    )
                ) {

                    continue;
                }


                if (
                    isProtectedTextNode(
                        node
                    )
                ) {

                    continue;
                }


                if (
                    node.nodeValue &&
                    node.nodeValue.trim()
                ) {

                    result.push(
                        node
                    );
                }
            }
        }


        return result;
    }


    /* =========================================================
       REDACT FIELD VALUE
       ========================================================= */

    function redactFieldValue(
        container,
        labelElement,
        labelInfo,
        stats
    ) {

        if (
            !container ||
            !labelElement
        ) {

            return;
        }


        if (
            isProtectedElement(
                container
            )
        ) {

            return;
        }


        if (
            isProtectedElement(
                labelElement
            )
        ) {

            return;
        }


        const valueNodes =
            getFieldValueNodes(
                container,
                labelElement
            );


        for (
            const node
            of valueNodes
        ) {

            if (
                isProtectedTextNode(
                    node
                )
            ) {

                continue;
            }


            if (
                labelElement.contains(
                    node
                )
            ) {

                continue;
            }


            const oldText =
                node.nodeValue;


            const value =
                oldText.trim();


            if (!value) {
                continue;
            }


            const start =
                oldText.indexOf(
                    value
                );


            if (
                start === -1
            ) {

                continue;
            }


            node.nodeValue =

                oldText.substring(
                    0,
                    start
                )

                +

                replacement()

                +

                oldText.substring(
                    start +
                    value.length
                );


            increment(
                stats,
                labelInfo.category
            );
        }
    }


    /* =========================================================
       LABELED FIELD SCANNER
       ========================================================= */

    function sanitizeLabeledFields(
        doc,
        stats
    ) {

        const elements =
            Array.from(
                doc.querySelectorAll("*")
            );


        for (
            const element
            of elements
        ) {

            /*
               Headings never processed.
            */

            if (
                isProtectedElement(
                    element
                )
            ) {

                continue;
            }


            /*
               Scripts etc.
            */

            if (
                isExecutableElement(
                    element
                )
            ) {

                continue;
            }


            const text =
                String(
                    element.textContent ||
                    ""
                )
                    .replace(
                        /\s+/g,
                        " "
                    )
                    .trim();


            if (
                !text ||
                text.length > 100
            ) {

                continue;
            }


            const labelInfo =
                findPIILabel(
                    text
                );


            if (!labelInfo) {
                continue;
            }


            if (
                !isPIILabelElement(
                    element
                )
            ) {

                continue;
            }


            const container =
                findFieldContainer(
                    element
                );


            if (!container) {
                continue;
            }


            if (
                isProtectedElement(
                    container
                )
            ) {

                continue;
            }


            const containerText =
                String(
                    container.textContent ||
                    ""
                )
                    .trim();


            if (
                containerText.length >
                700
            ) {

                continue;
            }


            redactFieldValue(
                container,
                element,
                labelInfo,
                stats
            );
        }
    }


    /* =========================================================
       TEXT NODE SCANNER
       ========================================================= */

    function sanitizeTextNodes(
        doc,
        stats
    ) {

        const root =
            doc.body ||
            doc;


        const walker =
            doc.createTreeWalker(

                root,

                NodeFilter.SHOW_TEXT
            );


        const nodes =
            [];


        let node;


        while (
            (
                node =
                    walker.nextNode()
            )
        ) {

            const parent =
                node.parentElement;


            if (!parent) {
                continue;
            }


            const tag =
                parent.tagName.toLowerCase();


            /*
               Never executable.
            */

            if (
                tag === "script" ||
                tag === "style" ||
                tag === "noscript" ||
                tag === "template"
            ) {

                continue;
            }


            /*
               NEVER headings.
            */

            if (
                isProtectedTextNode(
                    node
                )
            ) {

                continue;
            }


            /*
               NEVER labels.
            */

            if (
                isPIILabelElement(
                    parent
                )
            ) {

                continue;
            }


            /*
               NEVER text inside label-like elements.
            */

            if (
                isInsideLabelElement(
                    parent
                )
            ) {

                const labelAncestor =
                    parent.closest(
                        LABEL_SELECTOR
                    );


                if (
                    labelAncestor &&
                    isPIILabelElement(
                        labelAncestor
                    )
                ) {

                    continue;
                }
            }


            nodes.push(
                node
            );
        }


        /*
           Sanitize collected nodes.
        */

        for (
            const textNode
            of nodes
        ) {

            const parent =
                textNode.parentElement;


            if (!parent) {
                continue;
            }


            /*
               Final heading protection.
            */

            if (
                isProtectedTextNode(
                    textNode
                )
            ) {

                continue;
            }


            /*
               Final label protection.
            */

            if (
                isPIILabelElement(
                    parent
                )
            ) {

                continue;
            }


            if (
                isInsideLabelElement(
                    parent
                )
            ) {

                const labelAncestor =
                    parent.closest(
                        LABEL_SELECTOR
                    );


                if (
                    labelAncestor &&
                    isPIILabelElement(
                        labelAncestor
                    )
                ) {

                    continue;
                }
            }


            const oldValue =
                textNode.nodeValue;


            const context =
                getContext(
                    parent
                );


            const newValue =
                sanitizeText(
                    oldValue,
                    context,
                    stats
                );


            if (
                oldValue !==
                newValue
            ) {

                textNode.nodeValue =
                    newValue;
            }
        }
    }


    /* =========================================================
       FORM SANITIZATION
       ========================================================= */

    function sanitizeForms(
        doc,
        stats
    ) {

        const controls =
            doc.querySelectorAll(
                "input,textarea,select"
            );


        for (
            const element
            of controls
        ) {

            /*
               Preserve placeholder.
            */

            const originalPlaceholder =
                element.getAttribute(
                    "placeholder"
                );


            const name =
                normalize(
                    element.getAttribute(
                        "name"
                    )
                );


            const id =
                normalize(
                    element.id
                );


            const context =
                getContext(
                    element
                );


            const type =
                normalize(
                    element.getAttribute(
                        "type"
                    )
                );


            /*
               Placeholder NOT included.
            */

            const combined =
                [

                    context,

                    name,

                    id

                ].join(" ");


            const piiLabel =
                findPIILabel(
                    combined
                );


            /*
               Date input is always sensitive.
            */

            const sensitive =

                !!piiLabel

                ||

                /password|email|tel|phone|card|number|date|hidden/i
                    .test(
                        type
                    );


            if (
                sensitive &&
                "value" in element &&
                element.value
            ) {

                element.value =
                    replacement();


                if (
                    element.hasAttribute(
                        "value"
                    )
                ) {

                    element.setAttribute(
                        "value",
                        replacement()
                    );
                }


                increment(
                    stats,
                    "FORM"
                );
            }


            /*
               Restore placeholder exactly.
            */

            if (
                originalPlaceholder !==
                null
            ) {

                element.setAttribute(
                    "placeholder",
                    originalPlaceholder
                );
            }
        }
    }


    /* =========================================================
       ATTRIBUTE SANITIZATION
       ========================================================= */

    function sanitizeAttributes(
        doc,
        stats
    ) {

        const elements =
            Array.from(
                doc.querySelectorAll("*")
            );


        for (
            const element
            of elements
        ) {

            /*
               Never modify headings.
            */

            if (
                isProtectedElement(
                    element
                )
            ) {

                continue;
            }


            /*
               Never executable.
            */

            if (
                isExecutableElement(
                    element
                )
            ) {

                continue;
            }


            const attributes =
                Array.from(
                    element.attributes
                );


            for (
                const attribute
                of attributes
            ) {

                const name =
                    normalize(
                        attribute.name
                    );


                const value =
                    attribute.value;


                if (!value) {
                    continue;
                }


                /*
                   PLACEHOLDER IS NEVER TOUCHED.
                */

                if (
                    name ===
                    "placeholder"
                ) {

                    continue;
                }


                /*
                   Explicit sensitive data attributes.
                */

                if (
                    SENSITIVE_ATTRIBUTES.has(
                        name
                    )
                ) {

                    element.setAttribute(
                        attribute.name,
                        replacement()
                    );


                    increment(
                        stats,
                        "ATTRIBUTE"
                    );


                    continue;
                }


                /*
                   Generic sensitive data-*.
                */

                if (

                    name.startsWith(
                        "data-"
                    )

                    &&

                    /name|email|phone|mobile|address|city|state|country|account|card|cvv|token|secret|password|otp|pin|user|employee|student|patient|location|dob|birth|nominee|tax|upi|ifsc|passport|voter|vehicle|vin|imei|date|father|mother|parent|guardian/i
                        .test(
                            name
                        )
                ) {

                    element.setAttribute(
                        attribute.name,
                        replacement()
                    );


                    increment(
                        stats,
                        "DATA_ATTRIBUTE"
                    );
                }
            }
        }
    }


    /* =========================================================
       DATASET SANITIZATION
       ========================================================= */

    function sanitizeDataset(
        doc,
        stats
    ) {

        const elements =
            Array.from(
                doc.querySelectorAll("*")
            );


        for (
            const element
            of elements
        ) {

            if (
                isProtectedElement(
                    element
                )
            ) {

                continue;
            }


            const keys =
                Object.keys(
                    element.dataset ||
                    {}
                );


            for (
                const key
                of keys
            ) {

                const lower =
                    normalize(
                        key
                    );


                if (
                    !/name|email|phone|mobile|address|city|state|country|account|card|cvv|token|secret|password|otp|pin|user|employee|student|patient|location|dob|birth|nominee|tax|upi|ifsc|passport|voter|vehicle|vin|imei|date|father|mother|parent|guardian/i
                        .test(
                            lower
                        )
                ) {

                    continue;
                }


                if (
                    element.dataset[key]
                ) {

                    element.dataset[key] =
                        replacement();


                    increment(
                        stats,
                        "DATASET"
                    );
                }
            }
        }
    }


    /* =========================================================
       URL SANITIZATION
       ========================================================= */

    function sanitizeURLs(
        doc,
        stats
    ) {

        const elements =
            Array.from(
                doc.querySelectorAll(
                    "[href],[src],[action]"
                )
            );


        for (
            const element
            of elements
        ) {

            if (
                isProtectedElement(
                    element
                )
            ) {

                continue;
            }


            let attribute =
                null;


            if (
                element.hasAttribute(
                    "href"
                )
            ) {

                attribute =
                    "href";

            } else if (
                element.hasAttribute(
                    "src"
                )
            ) {

                attribute =
                    "src";

            } else if (
                element.hasAttribute(
                    "action"
                )
            ) {

                attribute =
                    "action";
            }


            if (!attribute) {
                continue;
            }


            const value =
                element.getAttribute(
                    attribute
                );


            if (!value) {
                continue;
            }


            try {

                const url =
                    new URL(
                        value,
                        "https://privacy-redactor.local"
                    );


                const sensitiveKeys =
                    [];


                url.searchParams.forEach(

                    function (_, key) {

                        if (
                            /email|phone|mobile|name|user|id|account|card|token|secret|password|otp|pin|address|dob|birth|passport|ifsc|upi|location|date|father|mother|parent/i
                                .test(
                                    key
                                )
                        ) {

                            sensitiveKeys.push(
                                key
                            );
                        }
                    }
                );


                for (
                    const key
                    of sensitiveKeys
                ) {

                    url.searchParams.set(
                        key,
                        replacement()
                    );


                    increment(
                        stats,
                        "URL"
                    );
                }


                let output;


                if (
                    value.startsWith("/") ||
                    value.startsWith("./") ||
                    value.startsWith("../") ||
                    value.startsWith("?")
                ) {

                    output =
                        url.pathname +
                        url.search +
                        url.hash;

                } else {

                    output =
                        url.toString();
                }


                element.setAttribute(
                    attribute,
                    output
                );

            } catch (error) {

                /*
                   Leave malformed URLs unchanged.
                */
            }
        }
    }


    /* =========================================================
       COMMENT SANITIZATION
       ========================================================= */

    function sanitizeComments(
        doc,
        stats
    ) {

        const walker =
            doc.createTreeWalker(
                doc,
                NodeFilter.SHOW_COMMENT
            );


        const comments =
            [];


        let node;


        while (
            (
                node =
                    walker.nextNode()
            )
        ) {

            comments.push(
                node
            );
        }


        for (
            const comment
            of comments
        ) {

            comment.nodeValue =
                sanitizeText(
                    comment.nodeValue,
                    "comment",
                    stats
                );
        }
    }


    /* =========================================================
       META SANITIZATION
       ========================================================= */

    function sanitizeMeta(
        doc,
        stats
    ) {

        const meta =
            Array.from(
                doc.querySelectorAll(
                    "meta"
                )
            );


        for (
            const element
            of meta
        ) {

            const name =
                normalize(

                    element.getAttribute(
                        "name"
                    )

                    ||

                    element.getAttribute(
                        "property"
                    )

                    ||

                    ""
                );


            const content =
                element.getAttribute(
                    "content"
                );


            if (!content) {
                continue;
            }


            if (
                /author|creator|owner|email|phone|profile|user|person|name|location|address|date|father|mother|parent/i
                    .test(
                        name
                    )
            ) {

                element.setAttribute(
                    "content",
                    replacement()
                );


                increment(
                    stats,
                    "META"
                );
            }
        }
    }


    /* =========================================================
       STYLE SANITIZATION
       ========================================================= */

    function sanitizeStyles(
        doc,
        stats
    ) {

        const elements =
            Array.from(
                doc.querySelectorAll(
                    "[style]"
                )
            );


        for (
            const element
            of elements
        ) {

            if (
                isProtectedElement(
                    element
                )
            ) {

                continue;
            }


            const oldStyle =
                element.getAttribute(
                    "style"
                );


            if (!oldStyle) {
                continue;
            }


            const newStyle =
                redactPatterns(
                    oldStyle,
                    stats
                );


            if (
                newStyle !==
                oldStyle
            ) {

                element.setAttribute(
                    "style",
                    newStyle
                );
            }
        }
    }


    /* =========================================================
       ACCESSIBILITY
       ========================================================= */

    function sanitizeAccessibility(
        doc,
        stats
    ) {

        /*
           Intentionally conservative.

           These attributes are preserved:

           aria-label
           aria-description
           title
           alt

           This prevents labels such as:

           "Enter your full name"
           "Enter your date of birth"

           from being redacted.
        */
    }


    /* =========================================================
       STATS
       ========================================================= */

    function createStats() {

        return {

            total:
                0,

            byType:
                {},

            startedAt:
                Date.now(),

            finishedAt:
                null,

            duration:
                0
        };
    }


    /* =========================================================
       DOM REDACTOR CLASS
       ========================================================= */

    class DOMRedactor {

        constructor(
            options = {}
        ) {

            this.options = {

                ...CONFIG,

                ...options
            };


            this.stats =
                createStats();
        }


        /* =====================================================
           SANITIZE
           ===================================================== */

        async sanitize(
            input
        ) {

            const stats =
                createStats();


            let html;


            /*
               STRING
            */

            if (
                typeof input ===
                "string"
            ) {

                html =
                    input;
            }


            /*
               BLOB
            */

            else if (

                typeof Blob !==
                    "undefined" &&

                input instanceof Blob

            ) {

                html =
                    await input.text();
            }


            /*
               DOCUMENT
            */

            else if (

                typeof Document !==
                    "undefined" &&

                input instanceof Document

            ) {

                html =
                    input
                        .documentElement
                        .outerHTML;
            }


            /*
               ELEMENT
            */

            else if (

                typeof Element !==
                    "undefined" &&

                input instanceof Element

            ) {

                html =
                    input.outerHTML;
            }


            else {

                throw new TypeError(

                    "DOMRedactor.sanitize() expects HTML string, Blob, Document, or Element."

                );
            }


            /*
               PARSE
            */

            const parser =
                new DOMParser();


            const doc =
                parser.parseFromString(
                    html,
                    "text/html"
                );


            /*
               1. FIELD VALUES
            */

            if (
                this.options.scanFieldValues
            ) {

                sanitizeLabeledFields(
                    doc,
                    stats
                );
            }


            /*
               2. NORMAL TEXT
            */

            if (
                this.options.scanText
            ) {

                sanitizeTextNodes(
                    doc,
                    stats
                );
            }


            /*
               3. FORMS
            */

            if (
                this.options.scanForms
            ) {

                sanitizeForms(
                    doc,
                    stats
                );
            }


            /*
               4. ATTRIBUTES
            */

            if (
                this.options.scanAttributes
            ) {

                sanitizeAttributes(
                    doc,
                    stats
                );
            }


            /*
               5. DATASET
            */

            if (
                this.options.scanDataset
            ) {

                sanitizeDataset(
                    doc,
                    stats
                );
            }


            /*
               6. URLS
            */

            if (
                this.options.scanURLs
            ) {

                sanitizeURLs(
                    doc,
                    stats
                );
            }


            /*
               7. COMMENTS
            */

            if (
                this.options.scanComments
            ) {

                sanitizeComments(
                    doc,
                    stats
                );
            }


            /*
               8. META
            */

            if (
                this.options.scanMeta
            ) {

                sanitizeMeta(
                    doc,
                    stats
                );
            }


            /*
               9. STYLES
            */

            if (
                this.options.scanStyles
            ) {

                sanitizeStyles(
                    doc,
                    stats
                );
            }


            /*
               10. ACCESSIBILITY
            */

            if (
                this.options.scanAccessibility
            ) {

                sanitizeAccessibility(
                    doc,
                    stats
                );
            }


            /*
               OUTPUT
            */

            const sanitizedHTML =

                "<!DOCTYPE html>\n" +

                doc.documentElement
                    .outerHTML;


            stats.finishedAt =
                Date.now();


            stats.duration =
                stats.finishedAt -
                stats.startedAt;


            this.stats =
                stats;


            return {

                doc:
                    doc,

                html:
                    sanitizedHTML,

                stats:
                    stats
            };
        }


        /* =====================================================
           STATIC SANITIZE
           ===================================================== */

        static async sanitize(
            input,
            options = {}
        ) {

            const redactor =
                new DOMRedactor(
                    options
                );


            return redactor.sanitize(
                input
            );
        }


        /* =====================================================
           EXPORT FILE
           ===================================================== */

        static exportDOMFile(
            html,
            filename =
                "sanitized_output_dom.html"
        ) {

            const blob =
                new Blob(
                    [html],
                    {
                        type:
                            "text/html;charset=utf-8"
                    }
                );


            const url =
                URL.createObjectURL(
                    blob
                );


            const anchor =
                document.createElement(
                    "a"
                );


            anchor.href =
                url;


            anchor.download =
                filename;


            anchor.style.display =
                "none";


            document.body.appendChild(
                anchor
            );


            anchor.click();


            setTimeout(

                function () {

                    anchor.remove();


                    URL.revokeObjectURL(
                        url
                    );

                },

                1000
            );
        }


        /* =====================================================
           UTILITIES
           ===================================================== */

        static getPIICategories() {

            return Object.keys(
                PII_LABELS
            );
        }


        static getReplacement() {

            return CONFIG.replacement;
        }


        static isCreditCard(
            value
        ) {

            return passesLuhn(
                value
            );
        }


        static isProtected(
            element
        ) {

            return isProtectedElement(
                element
            );
        }
    }


    /* =========================================================
       GLOBAL EXPORT
       ========================================================= */

    window.DOMRedactor =
        DOMRedactor;


    window.DOMRedactorConfig =
        CONFIG;


    window.DOMRedactorPIILabels =
        PII_LABELS;


    window.DOMRedactorProtection = {

        isProtectedElement:
            isProtectedElement,

        isProtectedTextNode:
            isProtectedTextNode,

        isPIILabelElement:
            isPIILabelElement
    };


})();