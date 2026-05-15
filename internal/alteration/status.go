package alteration

type Status int16

const (
	StatusReceived   Status = 0
	StatusInProgress Status = 1
	StatusReady      Status = 2
	StatusDelivered  Status = 3
	StatusCancelled  Status = 4
)

func (s Status) IsValid() bool {
	switch s {
	case StatusReceived, StatusInProgress, StatusReady,
		StatusDelivered, StatusCancelled:
		return true
	}
	return false
}

func (s Status) String() string {
	switch s {
	case StatusReceived:
		return "Received"
	case StatusInProgress:
		return "InProgress"
	case StatusReady:
		return "Ready"
	case StatusDelivered:
		return "Delivered"
	case StatusCancelled:
		return "Cancelled"
	}
	return "Unknown"
}
