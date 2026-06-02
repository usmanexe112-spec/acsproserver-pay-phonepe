<?php

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Content-Type: application/json");

$input = file_get_contents('php://input');

if (empty($input)) {
    echo json_encode(['status' => 'error', 'message' => 'No data received']);
    exit;
}

$data = json_decode($input, true);

// Log function
function logMessage($message) {
    $logFile = __DIR__ . "/api_log.txt";  // Log file in the same folder as the script
    file_put_contents($logFile, date("Y-m-d H:i:s") . " - " . $message . "\n", FILE_APPEND);
}


$LiveTokenUrl = "https://api.phonepe.com/apis/identity-manager/v1/oauth/token";


$LiveOrderUrl = "https://api.phonepe.com/apis/pg/checkout/v2/order/";

// Function to get access token
function getToken() {
    global $LiveTokenUrl;

    $curl = curl_init();    
    curl_setopt_array($curl, array(
        CURLOPT_URL => $LiveTokenUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => '',
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_POSTFIELDS => 'client_id=LIVE-SU2605271219483440801383&client_version=1&client_secret=00f6cf0e-d4a0-40b5-a5b6-45235fdee885=client_credentials',
        CURLOPT_HTTPHEADER => array(
          'Content-Type: application/x-www-form-urlencoded'
        ),
    ));
      
    $response = curl_exec($curl);
    curl_close($curl);

    $res = json_decode($response, true);
    
    return $res['access_token'] ?? null;
}

// Function to check payment status
function checkStatus($token, $txnid) {
    global $LiveOrderUrl;

    $curl = curl_init();
    curl_setopt_array($curl, array(
      CURLOPT_URL => $LiveOrderUrl . $txnid .'/status',
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_ENCODING => '',
      CURLOPT_MAXREDIRS => 10,
      CURLOPT_TIMEOUT => 0,
      CURLOPT_FOLLOWLOCATION => true,
      CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
      CURLOPT_CUSTOMREQUEST => 'GET',
      CURLOPT_HTTPHEADER => array(
        'Content-Type: application/json',
        'Authorization: O-Bearer ' . $token
      ),
    ));

    $response = curl_exec($curl);
    curl_close($curl);

    return json_decode($response, true);
}

// Main Execution
$token = getToken();
if ($token) {
    $txnid = $data['txnid'] ?? null;

    if (!$txnid) {
        logMessage("ERROR: Transaction ID missing");
        echo json_encode(["error" => "Transaction ID missing"]);
        exit;
    }

    $statusResponse = checkStatus($token, $txnid);

    if (isset($statusResponse['orderId'])) {
        $orderData = [
            'orderId' => $statusResponse['orderId'],
            'state' => $statusResponse['state'],
            'amount' => $statusResponse['amount'],
            'errorCode' => $statusResponse['errorCode'] ?? null,
            'udf1' => $statusResponse['metaInfo']['udf1'] ?? '',
            'udf2' => $statusResponse['metaInfo']['udf2'] ?? ''
        ];
        
        echo json_encode(['status' => 'success', 'wpResponse' => $orderData]);
    } else {
        logMessage("ERROR: Invalid response from PhonePe");
        echo json_encode(["error" => "Invalid response from PhonePe"]);
    }
} else {
    logMessage("ERROR: Failed to get access token");
    echo json_encode(["error" => "Failed to get access token"]);
}

?>
