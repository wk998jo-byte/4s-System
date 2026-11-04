from datetime import date, timedelta


def week_from_date(value: date) -> tuple[int, int]:
    """Sunday-start weeks; week 1 contains 1 January (requirements §4 / §12.9)."""
    jan1 = date(value.year, 1, 1)
    week1_sunday = jan1 - timedelta(days=(jan1.weekday() + 1) % 7)
    if value < week1_sunday:
        return week_from_date(date(value.year - 1, 12, 31))
    return value.year, (value - week1_sunday).days // 7 + 1
